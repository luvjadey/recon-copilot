import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
});

// Notes file path
const notesDir = path.join(os.homedir(), '.recon-copilot');
const notesFile = path.join(notesDir, 'recon-notes.md');

// Ensure notes directory exists
if (!fs.existsSync(notesDir)) {
	fs.mkdirSync(notesDir, { recursive: true });
}

// Define tools for RECON AGENT
const reconTools: Anthropic.Tool[] = [
	{
		name: 'port_scan',
		description: 'Runs an nmap port scan on a target to discover open ports and services',
		input_schema: {
			type: 'object' as const,
			properties: {
				target: {
					type: 'string',
					description: 'The target to scan (e.g., scanme.nmap.org, 127.0.0.1)',
				},
				ports: {
					type: 'string',
					description: 'Port range to scan (e.g., "1-1000" or "80,443"). Defaults to top 1000.',
				},
			},
			required: ['target'],
		},
	},
	{
		name: 'fetch_http_headers',
		description: 'Fetches HTTP headers from a target URL',
		input_schema: {
			type: 'object' as const,
			properties: {
				url: {
					type: 'string',
					description: 'The target URL (e.g., http://example.com)',
				},
			},
			required: ['url'],
		},
	},
];

// Define tools for ANALYSIS AGENT (reads from notes)
const analysisTools: Anthropic.Tool[] = [
	{
		name: 'read_recon_notes',
		description: 'Reads the reconnaissance notes gathered by the recon agent',
		input_schema: {
			type: 'object' as const,
			properties: {},
			required: [],
		},
	},
];

// Run nmap scan
function portScan(target: string, ports?: string): string {
	try {
		const portArg = ports ? `-p ${ports}` : '-p 1-1000';
		const nmapPath = 'C:\\Program Files (x86)\\Nmap\\nmap.exe';
		const command = `"${nmapPath}" -sV ${portArg} ${target}`;
		const result = execSync(command, { encoding: 'utf-8', timeout: 30000 });
		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return `Error running scan: ${errorMessage}`;
	}
}

// Fetch HTTP headers (simulated)
function fetchHttpHeaders(url: string): string {
	return `HTTP/1.1 200 OK
Server: Apache/2.4.41
Content-Type: text/html; charset=UTF-8
Content-Length: 1234
Cache-Control: max-age=3600
X-Powered-By: PHP/7.4.3
Set-Cookie: session=abc123; Path=/
Date: Thu, 02 Jul 2026 12:00:00 GMT`;
}

// Compact tool output (remove redundant lines, keep essentials)
function compactOutput(output: string): string {
	const lines = output.split('\n');
	const compacted = lines
		.filter((line) => {
			// Remove empty lines and verbose nmap output
			if (!line.trim()) return false;
			if (line.includes('Starting Nmap') || line.includes('Nmap scan report') || line.includes('Nmap done')) return true;
			if (line.includes('PORT') || line.includes('STATE') || line.includes('SERVICE')) return true;
			if (line.match(/^\d+\/\w+/)) return true; // Port lines
			return !line.startsWith('|') && !line.startsWith('MAC Address');
		})
		.join('\n');
	return compacted;
}

// Process tool calls for RECON AGENT
function processReconToolCall(toolName: string, toolInput: Record<string, unknown>): string {
	if (toolName === 'port_scan') {
		const target = toolInput.target as string;
		const ports = toolInput.ports as string | undefined;
		const output = portScan(target, ports);
		return compactOutput(output);
	} else if (toolName === 'fetch_http_headers') {
		const url = toolInput.url as string;
		return fetchHttpHeaders(url);
	}
	return 'Unknown tool';
}

// Process tool calls for ANALYSIS AGENT
function processAnalysisToolCall(toolName: string): string {
	if (toolName === 'read_recon_notes') {
		if (fs.existsSync(notesFile)) {
			return fs.readFileSync(notesFile, 'utf-8');
		}
		return 'No reconnaissance notes found.';
	}
	return 'Unknown tool';
}

// RECON AGENT: Gathers data and saves to notes
async function runReconAgent(target: string): Promise<void> {
	const reconPrompt = `You are a reconnaissance specialist. Your ONLY job is to gather data about the target: ${target}

Instructions:
1. Use available tools to gather data (port scan, HTTP headers)
2. Focus on FACTS and OBSERVATIONS only - no analysis yet
3. Compact your output - remove redundant lines
4. Be concise but complete

Gather comprehensive reconnaissance data now.`;

	const messages: Anthropic.MessageParam[] = [{ role: 'user', content: reconPrompt }];

	let response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 2048,
		tools: reconTools,
		messages: messages,
	});

	// Process tool calls in loop
	while (response.stop_reason === 'tool_use') {
		// Add the assistant response
		messages.push({ role: 'assistant', content: response.content });

		// Process ALL tool calls in this response
		const toolResults: Anthropic.ToolResultBlockParam[] = [];
		
		for (const block of response.content) {
			if (block.type === 'tool_use') {
				const toolResult = processReconToolCall(
					block.name,
					block.input as Record<string, unknown>
				);
				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: toolResult,
				});
			}
		}

		// Add all tool results in one user message
		if (toolResults.length > 0) {
			messages.push({
				role: 'user',
				content: toolResults,
			});
		}

		response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 2048,
			tools: reconTools,
			messages: messages,
		});
	}

	// Extract recon findings
	const reconFindings = response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block as Anthropic.TextBlock).text)
		.join('\n');

	// Save to notes file
	const notes = `# Reconnaissance Notes for ${target}
Generated: ${new Date().toISOString()}

## Raw Findings
${reconFindings}

---
`;

	fs.writeFileSync(notesFile, notes, 'utf-8');
	console.log(`Recon notes saved to ${notesFile}`);
}

// ANALYSIS AGENT: Reads notes and writes report
async function runAnalysisAgent(): Promise<string> {
	const analysisPrompt = `You are a security analyst. Your ONLY job is to analyze reconnaissance data and provide actionable insights.

Instructions:
1. Read the reconnaissance notes using the read_recon_notes tool
2. Analyze the findings for security implications
3. Provide:
   - Summary of discovered services
   - Potential vulnerabilities
   - Recommended next steps
4. Be concise and security-focused
5. Note any gaps or limitations in the data`;

	const messages: Anthropic.MessageParam[] = [{ role: 'user', content: analysisPrompt }];

	let response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 2048,
		tools: analysisTools,
		messages: messages,
	});

	// Process tool calls in loop
	while (response.stop_reason === 'tool_use') {
		// Add the assistant response
		messages.push({ role: 'assistant', content: response.content });

		// Process ALL tool calls in this response
		const toolResults: Anthropic.ToolResultBlockParam[] = [];
		
		for (const block of response.content) {
			if (block.type === 'tool_use') {
				const toolResult = processAnalysisToolCall(block.name);
				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: toolResult,
				});
			}
		}

		// Add all tool results in one user message
		if (toolResults.length > 0) {
			messages.push({
				role: 'user',
				content: toolResults,
			});
		}

		response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 2048,
			tools: analysisTools,
			messages: messages,
		});
	}

	// Extract analysis report
	const report = response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block as Anthropic.TextBlock).text)
		.join('\n');

	return report;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Recon Copilot activated!');

	const disposable = vscode.commands.registerCommand('recon-copilot.helloWorld', async () => {
		try {
			// Get target from user
			const target = await vscode.window.showInputBox({
				prompt: '🎯 Enter target to scan (e.g., scanme.nmap.org, 127.0.0.1)',
				placeHolder: 'scanme.nmap.org',
			});

			if (!target) {
				vscode.window.showWarningMessage('No target entered. Scan cancelled.');
				return;
			}

			// Ask for approval
			const approved = await vscode.window.showQuickPick(
				['✅ Approve', '❌ Deny'],
				{
					placeHolder: `Recon Copilot wants to scan ${target}. Approve?`,
				}
			);

			if (approved !== '✅ Approve') {
				vscode.window.showInformationMessage('Scan cancelled by user.');
				return;
			}

			vscode.window.showInformationMessage('🔍 Running reconnaissance...');

			// Run RECON AGENT
			await runReconAgent(target);
			vscode.window.showInformationMessage('✅ Reconnaissance complete. Running analysis...');

			// Run ANALYSIS AGENT
			const report = await runAnalysisAgent();

			// Display final report
			const outputChannel = vscode.window.createOutputChannel('Recon Copilot');
			outputChannel.clear();
			outputChannel.appendLine(`=== Security Analysis Report for ${target} ===\n`);
			outputChannel.appendLine(report);
			outputChannel.show();

			vscode.window.showInformationMessage('✅ Analysis complete! Check the output panel.');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Error: ${errorMessage}`);
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}