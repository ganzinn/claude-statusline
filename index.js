#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- ANSI / OSC helpers ----------------------------------------------------

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function link(url, text) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// ---- Formatting helpers ----------------------------------------------------

function truncateMiddle(str, max) {
  if (str.length <= max) return str;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${str.slice(0, head)}…${str.slice(str.length - tail)}`;
}

function formatDuration(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function formatTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function formatResetTime(epochSec) {
  const d = new Date(epochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function pctColor(pct, warn, danger) {
  if (pct >= danger) return RED;
  if (pct >= warn) return YELLOW;
  return GREEN;
}

const EFFORT_SHORT = { low: 'low', medium: 'med', high: 'hi', xhigh: 'xhi', max: 'max' };

// ---- Git info (cached) -----------------------------------------------------

const GIT_CACHE_TTL_MS = 5000;

function readGitInfo(dir, sessionId) {
  const cacheFile = path.join(os.tmpdir(), `claude-statusline-${sessionId || 'default'}`);
  try {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < GIT_CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch {}

  const info = { branch: '', dirty: false };
  try {
    const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 };
    // -b 付きの1コマンドでブランチ名(1行目の "## ...")と dirty 判定(2行目以降)をまとめて取る
    const lines = execSync(`git -C "${dir}" status --porcelain -b -unormal`, opts).split('\n');
    if (lines[0]?.startsWith('## ')) {
      const head = lines[0].slice(3);
      if (!head.startsWith('HEAD ')) {
        // "main...origin/main [ahead 1]" / "No commits yet on main" / detached は "HEAD (no branch)"
        info.branch = head.split('...')[0].replace(/^No commits yet on /, '');
      }
    }
    info.dirty = lines.slice(1).some((l) => l.trim().length > 0);
  } catch {}

  try {
    fs.writeFileSync(cacheFile, JSON.stringify(info));
  } catch {}
  return info;
}

// ---- Segment builders --------------------------------------------------------

function buildLocationSegment(data) {
  const parts = [];
  const dir = data.workspace?.current_dir || data.cwd || '';
  const repo = data.workspace?.repo;

  if (repo?.name) {
    const url = `https://${repo.host}/${repo.owner}/${repo.name}`;
    parts.push(`📁 ${link(url, repo.name)}`);
  } else if (dir) {
    parts.push(`📁 ${path.basename(dir)}`);
  }

  if (dir) {
    const git = readGitInfo(dir, data.session_id);
    if (git.branch) {
      const dirty = git.dirty ? '*' : '';
      parts.push(`${MAGENTA}🌿 ${truncateMiddle(git.branch, 25)}${dirty}${RESET}`);
    }
  }

  const worktree = data.worktree?.name || data.workspace?.git_worktree;
  if (worktree) parts.push(`${DIM}[wt:${worktree}]${RESET}`);

  if (data.pr?.number) {
    const label = `#${data.pr.number}`;
    parts.push(`${CYAN}${data.pr.url ? link(data.pr.url, label) : label}${RESET}`);
  }

  const added = data.cost?.total_lines_added || 0;
  const removed = data.cost?.total_lines_removed || 0;
  if (added || removed) {
    parts.push(`${GREEN}+${added}${RESET} ${RED}-${removed}${RESET}`);
  }

  return parts.join(' ');
}

function buildModelSegment(data) {
  const name = data.model?.display_name || 'Claude';
  const effort = EFFORT_SHORT[data.effort?.level];
  const suffix = effort ? ` ${DIM}${effort}${RESET}` : '';
  return `${CYAN}[${name}]${RESET}${suffix}`;
}

function buildContextSegment(data) {
  const cw = data.context_window;
  const pct = Math.floor(cw?.used_percentage ?? 0);
  const color = pctColor(pct, 70, 90);
  const usage = cw?.total_input_tokens != null && cw?.context_window_size
    ? `${formatTokens(cw.total_input_tokens)}/${formatTokens(cw.context_window_size)} `
    : '';
  return `${usage}${color}${DIM}${pct}%${RESET}`;
}

function buildSessionSegment(data) {
  const cost = data.cost;
  if (!cost) return '';
  const parts = [];
  if (cost.total_cost_usd != null) parts.push(`${YELLOW}$${cost.total_cost_usd.toFixed(2)}${RESET}`);
  if (cost.total_duration_ms != null) {
    parts.push(`⏱ ${formatDuration(cost.total_api_duration_ms)}${DIM}/${formatDuration(cost.total_duration_ms)}${RESET}`);
  }
  return parts.join(' | ');
}

function buildRateLimitSegment(data) {
  const parts = [];
  for (const [label, window] of [['5h', data.rate_limits?.five_hour], ['7d', data.rate_limits?.seven_day]]) {
    if (window?.used_percentage == null) continue;
    const pct = Math.round(window.used_percentage);
    const color = pctColor(pct, 80, 95);
    const reset = window.resets_at ? `${DIM}→${formatResetTime(window.resets_at)}${RESET}` : '';
    parts.push(`${label}: ${color}${pct}%${RESET}${reset}`);
  }
  return parts.join(' ');
}

// ---- Main --------------------------------------------------------------------

function render(data) {
  const line1 = [buildLocationSegment(data), buildModelSegment(data)]
    .filter(Boolean)
    .join(' | ');
  const line2 = [buildContextSegment(data), buildSessionSegment(data), buildRateLimitSegment(data)]
    .filter(Boolean)
    .join(' | ');
  return [line1, line2].filter(Boolean).join('\n');
}

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log('[Claude]');
    return;
  }
  try {
    console.log(render(data));
  } catch {
    console.log(`[${data.model?.display_name || 'Claude'}]`);
  }
});
