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
const reportsDir = path.join(notesDir, 'reports');

// Ensure directories exist
if (!fs.existsSync(notesDir)) {
	fs.mkdirSync(notesDir, { recursive: true });
}
if (!fs.existsSync(reportsDir)) {
	fs.mkdirSync(reportsDir, { recursive: true });
}

// Define tools for RECON AGENT (1)
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

// Define tools for ANALYSIS AGENT (2)
const analysisTools: Anthropic.Tool[] = [
	{
		name: 'read_file',
		description: 'Read the contents of a file (MCP filesystem operation)',
		input_schema: {
			type: 'object' as const,
			properties: {
				path: {
					type: 'string',
					description: 'The file path to read',
				},
			},
			required: ['path'],
		},
	},
	{
		name: 'write_file',
		description: 'Write content to a file (MCP filesystem operation)',
		input_schema: {
			type: 'object' as const,
			properties: {
				path: {
					type: 'string',
					description: 'The file path to write to',
				},
				content: {
					type: 'string',
					description: 'The content to write',
				},
			},
			required: ['path', 'content'],
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

// Fetch HTTP headers, in this project it is simulated
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

// Compact tool output
function compactOutput(output: string): string {
	const lines = output.split('\n').filter((line) => line.trim());

	if (output.includes('Nmap scan report')) {
		return lines
			.filter((line) => {
				const trimmed = line.trim();
				if (trimmed.match(/^\d+\/\w+/)) return true;
				if (trimmed.includes('PORT') || trimmed.includes('STATE') || trimmed.includes('SERVICE')) return true;
				if (trimmed.includes('Nmap scan report') || trimmed.includes('Host is up')) return true;
				return false;
			})
			.join('\n');
	}

	return lines.slice(0, 50).join('\n');
}

// Process tool calls for RECON AGENT (1)
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

// Process tool calls for ANALYSIS AGENT (2)
function processAnalysisToolCall(toolName: string, toolInput: Record<string, unknown>): string {
	if (toolName === 'read_file') {
		const filePath = toolInput.path as string;
		try {
			return fs.readFileSync(filePath, 'utf-8');
		} catch (error) {
			return `Error reading file: ${error}`;
		}
	} else if (toolName === 'write_file') {
		const filePath = toolInput.path as string;
		const content = toolInput.content as string;
		try {
			fs.writeFileSync(filePath, content, 'utf-8');
			return `File written successfully to ${filePath}`;
		} catch (error) {
			return `Error writing file: ${error}`;
		}
	}
	return 'Unknown tool';
}

// RECON AGENT
async function runReconAgent(target: string): Promise<void> {
	const reconPrompt = `You are a reconnaissance specialist. Your ONLY job is to gather raw data about the target: ${target}

Instructions:
1. Use available tools to gather data (port scan, HTTP headers)
2. Focus on FACTS and OBSERVATIONS only - no analysis yet
3. Output should be concise but complete
4. Do not interpret or analyze - just gather

Gather comprehensive reconnaissance data now.`;

	const messages: Anthropic.MessageParam[] = [{ role: 'user', content: reconPrompt }];

	let response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 2048,
		tools: reconTools,
		messages: messages,
	});

	while (response.stop_reason === 'tool_use') {
		messages.push({ role: 'assistant', content: response.content });

		const toolResults: Anthropic.ToolResultBlockParam[] = [];

		for (const block of response.content) {
			if (block.type === 'tool_use') {
				let toolResult = processReconToolCall(
					block.name,
					block.input as Record<string, unknown>
				);
				toolResult = compactOutput(toolResult);
				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: toolResult,
				});
			}
		}

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

	const rawFindings = response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block as Anthropic.TextBlock).text)
		.join('\n');

	const notes = `# Reconnaissance Notes for ${target}
Generated: ${new Date().toISOString()}

## Raw Findings (Compacted)
${rawFindings}

---
`;

	fs.writeFileSync(notesFile, notes, 'utf-8');
	console.log(`Recon notes saved to ${notesFile}`);
}

// SUMMARIZATION AGENT (3)
async function runSummarizationAgent(): Promise<string> {
	const notesContent = fs.existsSync(notesFile) 
		? fs.readFileSync(notesFile, 'utf-8') 
		: 'No reconnaissance notes found.';

	const summarizePrompt = `You are a data summarizer. Read the reconnaissance notes and compress them into a concise summary.

RECONNAISSANCE NOTES:
${notesContent}

Your output should be:
- One sentence per discovered service
- One sentence per potential vulnerability category
- A list of all open ports
- Keep it under 150 words

Be precise and skip redundant information.`;

	const messages: Anthropic.MessageParam[] = [
		{
			role: 'user',
			content: summarizePrompt,
		},
	];

	const response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 512,
		messages: messages,
	});

	return response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block as Anthropic.TextBlock).text)
		.join('\n');
}

// ANALYSIS AGENT (with MCP filesystem operations)
async function runAnalysisAgent(summary: string, target: string): Promise<{ report: string; reportPath: string }> {
	const reportFileName = `${target}-${Date.now()}.md`;
	const reportPath = path.join(reportsDir, reportFileName);

	const analysisPrompt = `You are a security analyst. Your job is to analyze reconnaissance data and write a detailed security report.

Summary of reconnaissance:
${summary}

Use the write_file tool to save your analysis to: ${reportPath}

Your report should include:
1. Summary of discovered services
2. Potential vulnerabilities ranked by severity
3. Recommended next steps
4. Data gaps and limitations

Format it as a markdown document. Be concise and security-focused.`;

	const messages: Anthropic.MessageParam[] = [{ role: 'user', content: analysisPrompt }];

	let response = await client.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 2048,
		tools: analysisTools,
		messages: messages,
	});

	// Process MCP tool calls
	while (response.stop_reason === 'tool_use') {
		messages.push({ role: 'assistant', content: response.content });

		const toolResults: Anthropic.ToolResultBlockParam[] = [];

		for (const block of response.content) {
			if (block.type === 'tool_use') {
				const toolResult = processAnalysisToolCall(
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

	const report = response.content
		.filter((block) => block.type === 'text')
		.map((block) => (block as Anthropic.TextBlock).text)
		.join('\n');

	return { report, reportPath };
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Recon Copilot activated!');

	const disposable = vscode.commands.registerCommand('recon-copilot.helloWorld', async () => {
		try {
			const target = await vscode.window.showInputBox({
				prompt: ' Enter target to scan (e.g., scanme.nmap.org, 127.0.0.1)',
				placeHolder: 'scanme.nmap.org',
			});

			if (!target) {
				vscode.window.showWarningMessage('No target entered. Scan cancelled.');
				return;
			}

			const approved = await vscode.window.showQuickPick(
				['Approve', 'Deny'],
				{
					placeHolder: `Recon Copilot wants to scan ${target}. Approve?`,
				}
			);

			if (approved !== 'Approve') {
				vscode.window.showInformationMessage('Scan cancelled by user.');
				return;
			}

			vscode.window.showInformationMessage('Running reconnaissance...');

			await runReconAgent(target);
			vscode.window.showInformationMessage('Recon complete. Summarizing findings...');

			const summary = await runSummarizationAgent();
			vscode.window.showInformationMessage('Summarization complete. Analyzing...');

			const { report, reportPath } = await runAnalysisAgent(summary, target);

			const outputChannel = vscode.window.createOutputChannel('Recon Copilot');
			outputChannel.clear();
			outputChannel.appendLine(`=== Security Analysis Report for ${target} ===\n`);
			outputChannel.appendLine(report);
			outputChannel.appendLine(`\n---\n`);
			outputChannel.appendLine(`Report saved to: ${reportPath}`);
			outputChannel.appendLine(`Summary used for analysis:\n${summary}`);
			outputChannel.show();

			vscode.window.showInformationMessage(`Analysis complete! Report saved to ${reportPath}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Error: ${errorMessage}`);
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}