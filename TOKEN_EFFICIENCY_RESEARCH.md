# only-context 토큰 효율화 연구 보고서

## 1. 현재 토큰 소비 현황

### 1.1 토큰 소비 지점 분석

| 구분 | 트리거 | 토큰 소비량 | 빈도 | 비고 |
|------|--------|------------|------|------|
| **맥락 주입** | 세션 시작 | ~4,000 | 매 세션 | 가장 큰 단일 비용 |
| **WebFetch 지식 추출** | 도구 사용 | ~400-600 | 사용 시마다 | 실시간 |
| **WebSearch 지식 추출** | 도구 사용 | ~400-600 | 사용 시마다 | 실시간 |
| **Context7 지식 추출** | 도구 사용 | ~400-600 | 사용 시마다 | 실시간 |
| **Q&A 요약** | 컴팩션/종료 | ~400 × N개 | 최대 10개 | 백그라운드 |
| **웹 리서치 요약** | 컴팩션/종료 | ~400 × N개 | 최대 10개 | 백그라운드 |
| **심층 지식 추출** | 컴팩션/종료 | ~800 | 1회 | 백그라운드 |
| **세션 요약** | 세션 종료 | ~200-400 | 1회 | 백그라운드 |
| **지식 병합** | 중복 감지 시 | ~300-500 | 유형별 | 선택적 |

### 1.2 시나리오별 토큰 소비 추정

#### 시나리오 A: 일반적인 30분 코딩 세션
```
세션 시작 맥락 주입:     4,000 토큰
WebFetch 2회:            1,000 토큰
WebSearch 1회:             500 토큰
컴팩션 (Q&A 3개):        1,200 토큰
세션 종료 요약:            300 토큰
────────────────────────────────
총합:                    7,000 토큰
```

#### 시나리오 B: 리서치 중심 세션 (많은 웹 검색)
```
세션 시작 맥락 주입:     4,000 토큰
WebFetch 10회:           5,000 토큰
WebSearch 5회:           2,500 토큰
Context7 3회:            1,500 토큰
컴팩션 (Q&A 10개):       4,000 토큰
심층 지식 추출:            800 토큰
세션 종료 요약:            400 토큰
────────────────────────────────
총합:                   18,200 토큰
```

#### 시나리오 C: 컴팩션 없는 짧은 세션
```
세션 시작 맥락 주입:     4,000 토큰
WebFetch 1회:              500 토큰
세션 종료 요약:            200 토큰
────────────────────────────────
총합:                    4,700 토큰
```

### 1.3 현재 기본 설정 문제점

```typescript
// plugin/src/shared/config.ts - 현재 기본값
const DEFAULT_CONFIG = {
  contextInjection: {
    enabled: true,
    maxTokens: 4000,              // ⚠️ 너무 높음
    includeRecentSessions: 3,     // ⚠️ 3개 세션 = 불필요하게 많음
    includeRelatedErrors: true,   // ⚠️ 항상 포함
    includeProjectPatterns: true, // ⚠️ 항상 포함
  },
  summarization: {
    enabled: true,
    model: 'sonnet',              // ⚠️ 비싼 모델
    sessionSummary: true,
    errorSummary: true,
  },
  capture: {
    bashOutput: {
      enabled: true,
      maxLength: 5000,            // ⚠️ ~1,250 토큰 상당
    },
  },
};
```

---

## 2. 토큰 효율화 전략

### 2.1 설정 기반 최적화 (즉시 적용 가능)

#### 권장 "효율 모드" 설정

```json
{
  "contextInjection": {
    "enabled": true,
    "maxTokens": 1500,
    "includeRecentSessions": 1,
    "includeRelatedErrors": false,
    "includeProjectPatterns": true
  },
  "summarization": {
    "enabled": true,
    "model": "haiku",
    "sessionSummary": true,
    "errorSummary": false
  },
  "capture": {
    "bashOutput": {
      "enabled": true,
      "maxLength": 1000
    }
  }
}
```

**예상 절감 효과:**
- 맥락 주입: 4,000 → 1,500 토큰 (**62.5% 절감**)
- 요약 비용: Sonnet → Haiku (**~75% 비용 절감**)
- 세션당 총 절감: **약 50-60%**

### 2.2 코드 레벨 최적화 제안

#### A. 지연 로딩 (Lazy Loading) 구현

현재 `session-start.ts`는 무조건 전체 맥락을 로드합니다. 대안:

```typescript
// 제안: 스마트 맥락 주입
async function smartContextInjection(project: string, config: Config) {
  const vault = new VaultManager(...);

  // 1단계: 최소 맥락만 주입 (프로젝트명, 최근 1개 세션 요약)
  const minimalContext = await vault.getMinimalContext(project);

  // 2단계: 필요 시 mem_project_context로 추가 로드 가능하다고 안내
  return formatMinimalContext(minimalContext);
}
```

#### B. 조건부 지식 추출

현재 모든 WebFetch/WebSearch가 요약됩니다. 대안:

```typescript
// 제안: 조건부 지식 추출
async function shouldExtractKnowledge(toolName: string, output: string): boolean {
  // 너무 짧은 결과는 스킵
  if (output.length < 500) return false;

  // 에러 페이지는 스킵
  if (output.includes('404') || output.includes('Access Denied')) return false;

  // 중복 URL 체크
  const url = extractUrl(output);
  if (await vault.hasKnowledgeForUrl(url)) return false;

  return true;
}
```

#### C. 토큰 예산 관리 시스템

```typescript
// 제안: 세션별 토큰 예산 관리
interface TokenBudget {
  session: {
    total: number;      // 세션 총 예산 (예: 10,000)
    used: number;       // 사용량
    remaining: number;  // 잔여량
  };
  breakdown: {
    contextInjection: number;
    knowledgeExtraction: number;
    summarization: number;
  };
}

// 예산 초과 시 자동으로 비활성화
function checkBudget(operation: string, estimatedCost: number): boolean {
  const budget = getBudget();
  if (budget.used + estimatedCost > budget.total) {
    console.warn(`Token budget exceeded. Skipping ${operation}`);
    return false;
  }
  return true;
}
```

#### D. 배치 요약 최적화

현재 각 Q&A를 개별 요약합니다. 대안:

```typescript
// 제안: 배치 요약으로 API 호출 감소
async function batchSummarize(items: QAPair[]): Promise<KnowledgeItem[]> {
  // 여러 Q&A를 하나의 프롬프트로 묶어서 요약
  const prompt = `Summarize these ${items.length} Q&A pairs as a batch...`;

  // 1회 API 호출로 여러 항목 처리
  // 예: 10개 개별 호출 (4,000 토큰) → 1회 배치 호출 (1,500 토큰)
  return await runBatchQuery(prompt);
}
```

### 2.3 새로운 설정 옵션 제안

```typescript
interface EnhancedConfig {
  // 기존 설정...

  // 새로운 효율화 옵션
  efficiency: {
    // 토큰 예산 (세션당)
    tokenBudget: number;  // 기본값: 15000

    // 지연 로딩 활성화
    lazyContextLoading: boolean;  // 기본값: true

    // 최소 컨텐츠 길이 (이하는 추출 스킵)
    minContentLengthForExtraction: number;  // 기본값: 500

    // 배치 요약 활성화
    batchSummarization: boolean;  // 기본값: true

    // 중복 URL 체크
    skipDuplicateUrls: boolean;  // 기본값: true

    // 실시간 지식 추출 비활성화 (컴팩션 시에만)
    deferKnowledgeExtraction: boolean;  // 기본값: false
  };
}
```

---

## 3. 구현 우선순위 및 로드맵

### Phase 1: 설정 기반 최적화 (즉시 적용)

1. **기본값 조정**
   - `maxTokens`: 4000 → 2000
   - `includeRecentSessions`: 3 → 1
   - `model`: 'sonnet' → 'haiku'
   - `bashOutput.maxLength`: 5000 → 2000

2. **README에 효율 모드 설정 가이드 추가**

**예상 노력:** 1시간
**예상 절감:** 40-50%

### Phase 2: 조건부 처리 구현 (단기)

1. **지식 추출 필터링**
   - 최소 길이 체크
   - 에러 페이지 스킵
   - 중복 URL 체크

2. **스마트 맥락 주입**
   - 프로젝트 활동 수준에 따른 동적 조정

**예상 노력:** 2-3시간
**예상 절감:** 추가 20-30%

### Phase 3: 고급 최적화 (중기)

1. **토큰 예산 관리 시스템**
2. **배치 요약 구현**
3. **지연 로딩 메커니즘**

**예상 노력:** 1-2일
**예상 절감:** 추가 20-30%

---

## 4. 프리셋 설정 제안

### 4.1 "최소" 프리셋 (Minimal)

토큰 사용을 최소화, 필수 기능만 유지

```json
{
  "contextInjection": {
    "enabled": true,
    "maxTokens": 500,
    "includeRecentSessions": 0,
    "includeRelatedErrors": false,
    "includeProjectPatterns": false
  },
  "summarization": {
    "enabled": false
  },
  "capture": {
    "fileEdits": true,
    "bashCommands": false,
    "bashOutput": { "enabled": false },
    "errors": true,
    "decisions": true
  }
}
```

**예상 토큰/세션:** ~500-1,000

### 4.2 "균형" 프리셋 (Balanced) - 권장

효율성과 기능의 균형

```json
{
  "contextInjection": {
    "enabled": true,
    "maxTokens": 1500,
    "includeRecentSessions": 1,
    "includeRelatedErrors": false,
    "includeProjectPatterns": true
  },
  "summarization": {
    "enabled": true,
    "model": "haiku",
    "sessionSummary": true,
    "errorSummary": false
  },
  "capture": {
    "fileEdits": true,
    "bashCommands": true,
    "bashOutput": {
      "enabled": true,
      "maxLength": 1000
    },
    "errors": true,
    "decisions": true
  }
}
```

**예상 토큰/세션:** ~3,000-5,000

### 4.3 "풀" 프리셋 (Full) - 현재 기본값

모든 기능 활성화, 토큰 소비 최대

```json
{
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeRecentSessions": 3,
    "includeRelatedErrors": true,
    "includeProjectPatterns": true
  },
  "summarization": {
    "enabled": true,
    "model": "sonnet",
    "sessionSummary": true,
    "errorSummary": true
  },
  "capture": {
    "fileEdits": true,
    "bashCommands": true,
    "bashOutput": {
      "enabled": true,
      "maxLength": 5000
    },
    "errors": true,
    "decisions": true
  }
}
```

**예상 토큰/세션:** ~7,000-18,000

---

## 5. 측정 및 모니터링 제안

### 5.1 토큰 사용량 추적 기능

```typescript
// 제안: 토큰 사용량 로깅
interface TokenUsageLog {
  sessionId: string;
  timestamp: Date;
  operations: {
    type: 'context_injection' | 'knowledge_extraction' | 'summarization';
    estimatedTokens: number;
    model: string;
  }[];
  totalEstimated: number;
}

// 세션 종료 시 통계 출력
console.log(`Session token usage: ~${totalTokens} tokens`);
```

### 5.2 MCP 도구 추가: `mem_stats`

```typescript
// 세션/프로젝트별 토큰 사용 통계 조회
server.registerTool('mem_stats', {
  description: 'Get token usage statistics',
  parameters: {
    project: { type: 'string', optional: true },
    period: { type: 'string', enum: ['session', 'day', 'week'] }
  },
  handler: async (params) => {
    return await getTokenStats(params);
  }
});
```

---

## 6. 결론 및 권장사항

### 즉시 적용할 수 있는 권장 사항

1. **기본값을 "균형" 프리셋으로 변경**
   - 신규 사용자의 토큰 소비를 즉시 50% 절감

2. **README에 프리셋 설정 가이드 추가**
   - 사용자가 자신의 상황에 맞게 선택 가능

3. **요약 모델 기본값을 haiku로 변경**
   - 품질 저하 미미, 비용 75% 절감

### 중장기 개선 방향

1. **토큰 예산 관리 시스템 도입**
   - 사용자가 세션당 토큰 상한 설정 가능

2. **스마트 지식 추출**
   - 불필요한 추출 자동 스킵

3. **배치 처리 최적화**
   - API 호출 수 감소

---

## 부록: 토큰 계산 참고

| 단위 | 토큰 환산 |
|------|----------|
| 1 영어 단어 | ~1.3 토큰 |
| 1 한글 글자 | ~1.5-2 토큰 |
| 1,000 문자 (영문) | ~250 토큰 |
| 1,000 문자 (한글) | ~400-500 토큰 |

**모델별 비용 비교 (추정):**
- Haiku: 1x (기준)
- Sonnet: 3-4x
- Opus: 10-15x
