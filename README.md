# Recon Copilot

**AI-powered security reconnaissance for VS Code.** Point it at a target, approve the scan, and Recon Copilot orchestrates a pipeline of specialized AI agents to run a real port scan, distill the findings, and write a security report for you.

> ⚠️ **Authorized use only.** Only scan systems you own or have explicit permission to test. `scanme.nmap.org` is provided by the Nmap project for exactly this purpose.

---

## How it works

Recon Copilot chains three AI agents (powered by Anthropic's Claude), each with a narrow, well-defined role:

| Agent | Role |
|-------|------|
| 🔍 **Recon Agent** | Runs `nmap` port scans and fetches live HTTP headers. Facts only — no analysis. |
| 📝 **Summarization Agent** | Compacts raw findings into key facts (open ports, services, vuln categories) to save API tokens. |
| 🧠 **Analysis Agent** | Analyzes the summary and writes a severity-ranked security report to disk via filesystem tools. |

```
Target ──▶ Recon Agent ──▶ Summarization Agent ──▶ Analysis Agent ──▶ Report
         (nmap + HTTP)      (compact to facts)       (analyze + write)
```

## Features

- **Human-in-the-loop approval** — nothing is scanned until you explicitly approve the target.
- **Multi-agent architecture** — specialized agents with isolated responsibilities.
- **Token-optimized pipeline** — output compaction feeds a summarization step, keeping downstream prompts small.
- **Filesystem integration** — reports are written automatically to disk (MCP-style `read_file` / `write_file` tools).
- **Real recon** — actual `nmap -sV` scans and live HTTP header fetches, not simulated results.

## Requirements

- **VS Code** `^1.120.0`
- **[Nmap](https://nmap.org/download.html)** installed locally. The scan currently expects the Windows default install path:
  `C:\Program Files (x86)\Nmap\nmap.exe`
- **Anthropic API key** — [get one here](https://console.anthropic.com/).

## Setup

1. Clone this repo and install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press `F5` in VS Code to launch the Extension Development Host.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run the **Recon Copilot** command.
3. Enter a target (e.g. `scanme.nmap.org` or `127.0.0.1`).
4. **Approve** the scan when prompted.
5. Watch the pipeline run — recon → summarize → analyze. The final report opens in the **Recon Copilot** output channel and is saved to disk.

Reports and notes are stored under your home directory:

```
~/.recon-copilot/
├── recon-notes.md          # raw recon findings
└── reports/
    └── <target>-<timestamp>.md
```

## Tech stack

- TypeScript + VS Code Extension API
- [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) — agent orchestration (model: `claude-haiku-4-5`)
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — filesystem tool integration
- `nmap` — port scanning

## Notes & limitations

- HTTP header fetching issues a live `HEAD` request (15s timeout, redirects not followed).
- The nmap path is hardcoded to the Windows default; adjust `portScan()` in [`src/extension.ts`](src/extension.ts) for other platforms.
- This is a demonstration of agentic AI patterns (multi-agent orchestration, human-in-the-loop, token optimization) — review and harden before any production use.

## License

See repository for license details.
