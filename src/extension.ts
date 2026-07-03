import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
});

// Define tools
const tools: Anthropic.Tool[] = [
	{
		name: 'port_scan',
		description: 'Runs an nmap port scan on a target to discover open ports and services',
		input_schema: {
			type: 'object' as const,
			properties: {
				target: {
					type: 'string',
					description: 'The target to scan (e.g., scanme.nmap.org, 127.0.0.1, or a domain)',
				},
				ports: {
					type: 'string',
					description: 'Port range to scan (e.g., "1-1000" or "80,443,3306"). Defaults to top 1000.',
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

// Run nmap scan
function portScan(target: string, ports?: string): string {
	try {
		const portArg = ports ? `-p ${ports}` : '-p 1-1000';
		// Use full path to nmap on Windows
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

// Process tool calls
function processToolCall(toolName: string, toolInput: Record<string, unknown>): string {
	if (toolName === 'port_scan') {
		const target = toolInput.target as string;
		const ports = toolInput.ports as string | undefined;
		return portScan(target, ports);
	} else if (toolName === 'fetch_http_headers') {
		const url = toolInput.url as string;
		return fetchHttpHeaders(url);
	}
	return 'Unknown tool';
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

			// Ask for approval BEFORE running any tools
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

			vscode.window.showInformationMessage('🔍 Recon Copilot: Running reconnaissance...');

			// Create the prompt
			const userPrompt = `Investigate the target: ${target}
			
Use the port_scan tool to discover open ports and services. Based on the scan results, provide:
1. A summary of open ports and services
2. Potential security concerns
3. Recommended next steps for deeper reconnaissance

Be concise and security-focused.`;

			// Start conversation with Claude
			const messages: Anthropic.MessageParam[] = [
				{ role: 'user', content: userPrompt },
			];

			// Call Claude with tools
			let response = await client.messages.create({
				model: 'claude-haiku-4-5-20251001',
				max_tokens: 2048,
				tools: tools,
				messages: messages,
			});

			// Process tool calls in a loop
			while (response.stop_reason === 'tool_use') {
				const toolUseBlock = response.content.find(
					(block) => block.type === 'tool_use'
				) as Anthropic.ToolUseBlock | undefined;

				if (!toolUseBlock) break;

				// Call the tool
				const toolResult = processToolCall(
					toolUseBlock.name,
					toolUseBlock.input as Record<string, unknown>
				);

				// Add to messages
				messages.push({ role: 'assistant', content: response.content });
				messages.push({
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: toolUseBlock.id,
							content: toolResult,
						},
					],
				});

				// Continue conversation
				response = await client.messages.create({
					model: 'claude-haiku-4-5-20251001',
					max_tokens: 2048,
					tools: tools,
					messages: messages,
				});
			}

			// Extract final response
			const finalResponse = response.content
				.filter((block) => block.type === 'text')
				.map((block) => (block as Anthropic.TextBlock).text)
				.join('\n');

			// Show result in output channel (better for large text)
			const outputChannel = vscode.window.createOutputChannel('Recon Copilot');
			outputChannel.clear();
			outputChannel.appendLine(`=== Reconnaissance Report for ${target} ===\n`);
			outputChannel.appendLine(finalResponse);
			outputChannel.show();

			vscode.window.showInformationMessage('✅ Reconnaissance complete! Check the output panel.');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Error: ${errorMessage}`);
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}