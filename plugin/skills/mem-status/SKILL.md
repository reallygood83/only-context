---
name: mem-status
description: 현재 세션에서 무엇이 기록되었는지, 그리고 전체 기억 시스템의 건강 상태를 확인합니다. 마치 자동차 계기판을 보듯 시스템의 상태를 한눈에 파악하세요.
version: 1.0.0
allowed-tools:
  - mcp__only-context__mem_project_context
  - mcp__only-context__mem_list_projects
  - Bash
---

# 기억 상태 스킬 (Memory Status Skill)

현재 세션이 얼마나 잘 기록되고 있는지, 그리고 내 기억 시스템이 건강하게 돌아가고 있는지 진단합니다.

## 언제 사용하나요? (When to Use)

- **기록 확인**: "방금 내가 한 작업들이 잘 저장되고 있나?" 궁금할 때.
- **시스템 점검**: "혹시 기억 시스템이 졸고 있지는 않나?" 확인하고 싶을 때.
- **활동 리뷰**: "내가 오늘 얼마나 열심히 코딩했지?" 뿌듯함을 느끼고 싶을 때.
- **프로젝트 목록**: "어떤 프로젝트들을 관리하고 있지?" 살펴보고 싶을 때.

## 사용법 (Usage)

```
/mem-status
/mem-status projects (프로젝트 목록만 보고 싶을 때)
/mem-status session (현재 세션 정보만 보고 싶을 때)
```

## 작업 흐름 (Workflow)

1. **워커 서비스(일꾼) 깨우기 (Check Worker Service)**
   ```bash
   curl -s http://localhost:37781/health
   ```
   "야, 일 잘하고 있니?" 하고 찔러봅니다.

2. **현재 세션 정보 가져오기 (Get Current Session)**
   ```bash
   curl -s http://localhost:37781/session/current
   ```
   "지금 뭐 적고 있어?" 하고 물어봅니다.

3. **프로젝트 목록 확인 (List Projects)**
   `mem_list_projects` 도구로 관리 중인 프로젝트들을 쭉 훑어봅니다.

4. **프로젝트 맥락 파악 (Get Project Context)**
   활성 프로젝트가 있다면 `mem_project_context`로 깊이 있는 정보를 가져옵니다.

## 출력 형식 (Output Format)

```markdown
## 기억 시스템 상태 보고서 (Memory System Status)

### 👷 워커 서비스 (일꾼 상태)
- **상태**: 정상 가동 중 (Running)
- **가동 시간**: 2시간 째 열일 중
- **포트**: 37781

### 📝 현재 세션
- **세션 ID**: abc-123
- **프로젝트**: my-project
- **시작 시간**: 2시간 전
- **관찰된 활동**: 15건

#### 이번 세션 캡처 현황
| 유형 | 개수 |
|------|-------|
| 파일 편집 | 8 |
| 명령어 | 5 |
| 오류 | 2 |

### 📚 관리 중인 프로젝트
1. project-a (마지막 활동: 1일 전)
2. project-b (마지막 활동: 3일 전)
3. my-project (현재 활성)

### 📊 빠른 통계
- 총 노트 수: 156개
- 기록된 세션: 42개
- 발견한 오류: 23개
- 내린 결정: 15개
```

## 문제 해결 (Troubleshooting)

혹시 워커(일꾼)가 응답이 없다면?
1. **생존 확인**: `ps aux | grep worker`
2. **수동 기동**: `bun run src/worker/index.ts` (직접 깨우기)
3. **설정 확인**: `cat ~/.only-context/config.json` (주소가 잘못됐나?)

데이터가 안 쌓인다구요?
1. **훅(Hook) 확인**: `.claude/hooks.json` 파일이 잘 있나 보세요.
2. **볼트 경로 확인**: 금고 위치가 정확한지 확인하세요.
3. **쓰기 권한**: 금고 문이 잠겨있지는 않은지(권한 문제) 확인하세요.
