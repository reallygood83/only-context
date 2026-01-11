# only-context

Claude Code에 지속 가능한 프로젝트 컨텍스트를 구축하는 Obsidian 기반의 영구 기억 시스템입니다. 세션 활동, 오류, 결정사항, 그리고 패턴들을 자동으로 캡처하여, 탐색과 시각화가 가능한 지식 베이스로 만들어줍니다.

## 주요 기능

- **자동 캡처**: 세션 훅(Hook)을 통해 파일 편집, 명령어 실행, 오류 발생을 자동으로 기록합니다.
- **AI 요약**: Claude를 활용해 세션을 요약하고 핵심 지식을 추출합니다.
- **Obsidian 통합**: Obsidian 문법을 완벽 지원하며, Dataview 쿼리를 통해 데이터를 시각화할 수 있습니다.
- **프로젝트 정리**: 프로젝트별로 기억을 정리하고, 여러 프로젝트에 걸친 공통 패턴을 관리합니다.
- **MCP 도구**: Claude Code 내에서 직접 기억을 검색(Search), 읽기(Read), 쓰기(Write) 할 수 있습니다.
- **유용한 스킬**: 사용자가 직접 호출 가능한 명령어 (`/mem-search`, `/mem-save`, `/mem-status`)를 제공합니다.

> 💡 **왜 맥락이 중요할까요?**
> 단순한 도구 사용법을 넘어, 이 시스템을 통해 어떻게 **'맥락의 지배자'**가 될 수 있는지 궁금하다면 [**활용 전략 가이드 (CONTEXT_STRATEGY.md)**](./CONTEXT_STRATEGY.md)를 확인하세요.

## 빠른 시작 (Quick Start)

### 사전 요구 사항

- [Bun](https://bun.sh/) 런타임 설치
- [Obsidian](https://obsidian.md/) 및 기존 볼트(Vault)
- [Dataview 플러그인](https://github.com/blacksmithgu/obsidian-dataview) (대시보드 활용 시 권장)
- Claude Code CLI

### 1단계: 플러그인 설치

**GitHub 또는 로컬 클론 설치**

```bash
# 리포지토리 복제
git clone https://github.com/reallygood83/only-context.git
cd only-context/plugin
bun install

# Claude Code에서 실행 (경로는 실제 clone 위치로 변경하세요):
/plugin marketplace add /path/to/only-context
/plugin install only-context
```

### 2단계: 볼트(Vault) 설정

설정 마법사를 실행하여 설정을 진행합니다:

```bash
# 플러그인 디렉토리로 이동 후 setup 실행
cd ~/.claude/plugins/only-context  # 또는 clone 받은 위치
cd plugin && bun run setup
```

마법사가 Obsidian 볼트 경로를 묻고 설정 파일을 생성합니다.

**또는 수동으로 설정 파일 생성** (`~/.only-context/config.json`):

```json
{
  "vault": {
    "path": "/path/to/your/obsidian/vault",
    "memFolder": "_claude-mem"
  },
  "capture": {
    "fileEdits": true,
    "bashCommands": true,
    "bashOutput": { "enabled": true, "maxLength": 5000 },
    "errors": true,
    "decisions": true
  },
  "summarization": {
    "enabled": true,
    "model": "sonnet",
    "sessionSummary": true,
    "errorSummary": true
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeRecentSessions": 3,
    "includeRelatedErrors": true,
    "includeProjectPatterns": true
  }
}
```

> **참고**: AI 요약 기능은 Claude Code CLI (`claude -p`)를 사용하므로 별도의 API 키가 필요하지 않습니다. 사용 가능한 모델: `sonnet`, `opus`, `haiku`.

### 3단계: Claude Code 재시작

플러그인과 훅(Hook)을 로드하기 위해 Claude Code를 재시작합니다.

### 4단계: 적극적인 기억 사용 활성화 (중요!)

플러그인은 MCP 도구를 제공하지만, Claude에게 이를 적극적으로 사용하도록 지시하지 않으면 자동으로 사용하지 않을 수 있습니다. 프로젝트의 `CLAUDE.md` 파일에 다음 내용을 추가하세요:

```markdown
## Memory System (only-context)

You have access to a persistent memory system via MCP tools. Use it proactively.

### Available Tools

| Tool | Use When |
|------|----------|
| `mem_search` | Looking for past decisions, errors, patterns, or context |
| `mem_read` | Need full content of a specific note |
| `mem_write` | Saving important decisions, patterns, or learnings |
| `mem_supersede` | Updating/replacing outdated information |
| `mem_project_context` | Starting work on a project (get recent context) |
| `mem_list_projects` | Need to see all tracked projects |

### When to Search Memory

**Proactively search memory (`mem_search`) when:**
- Starting work on a codebase - check for project context and recent decisions
- Encountering an error - search for similar errors and their solutions
- Making architectural decisions - look for related past decisions
- User asks "how did we..." or "why did we..." or "what was..."
- Implementing a feature similar to past work

### When to Save to Memory

**Save to memory (`mem_write`) when:**
- Making significant architectural or technical decisions
- Discovering important patterns or gotchas
- Solving tricky bugs (save the solution)
- Learning something project-specific that will be useful later
```

전역 설정인 `~/.claude/CLAUDE.md`에 추가하면 모든 프로젝트에 적용됩니다.

---

## 사용 방법 (Usage)

### 자동 캡처 (Automatic Capture)

설치가 완료되면 플러그인은 자동으로 다음 작업을 수행합니다:
- 세션 중 파일 편집, bash 명령어, 오류 기록
- 관찰 내용이 담긴 세션 노트 생성
- 웹 검색 및 문서 조회 시 지식 추출
- `/compact` 실행 또는 세션 종료 시 AI 요약 생성

### 스킬 (사용자 명령어)

#### `/mem-search` - 지식 베이스 검색
```
/mem-search authentication error fix
/mem-search database schema decisions
/mem-search recent sessions
```

#### `/mem-save` - 지식을 명시적으로 저장
```
/mem-save decision: JSON 지원을 위해 PostgreSQL을 선택함
/mem-save pattern: 이메일 유효성 검사 정규식
/mem-save learning: API 속도 제한은 100 req/min 임
```

#### `/mem-status` - 시스템 상태 확인
```
/mem-status
```

---

## 아키텍처 (Architecture)

```
┌──────────────┐     ┌─────────────┐     ┌────────────────┐
│ Claude Code  │◄───►│ MCP Server  │◄───►│ Obsidian Vault │
└──────┬───────┘     └─────────────┘     └────────────────┘
       │
       ▼
┌──────────────┐     ┌─────────────┐
│    Hooks     │────►│Session Store│
│ (Lifecycle)  │     │ (File-based)│
└──────────────┘     └─────────────┘
```

---

## 문제 해결 (Troubleshooting)

### 플러그인이 로드되지 않을 때
1. 설치 확인: `/plugin list` 목록에 `only-context`가 있는지 확인
2. 유효성 검사: `claude plugin validate ~/.claude/plugins/only-context`
3. 디버그 모드: `claude --debug`

### 데이터가 캡처되지 않을 때
1. 설치 후 Claude Code 재시작 필요
2. 설정 파일 존재 확인: `cat ~/.only-context/config.json`
3. 볼트 경로가 정확하고 쓰기 권한이 있는지 확인

---

## 라이선스 (License)

MIT

## 크레딧

Inspired by [claude-mem](https://github.com/thedotmack/claude-mem) by thedotmack.
Based on cc-obsidian-mem.
