# 페어 프로그래밍 리서치 — 수집 기록 복구

**복구 당시 상태: 미완료. 당시 최종 근거 브리프와 패턴 우선순위는 작성되지 않았다.**

> **후속 체크포인트 — 2026-09-14:** 핵심 원문을 대조한 [초기 설계용 근거 브리프](2026-09-14-pair-programming-evidence-brief.md)를 별도로 작성했다. 패턴 구성은 사용자 승인 전 제안이며, 전수 문헌고찰 완료를 뜻하지 않는다. 아래의 수집 결과·미완료 표현은 중단된 이전 리서치의 역사적 기록이다. 새 설계 검토는 [작업 설계안](../superpowers/specs/2026-09-14-adaptive-pair-v2-working-design.md)을 따른다.

이 문서는 2026-09-14에 중단된 리서치의 로컬 도구 기록을 복구한 것이다. 새 웹 리서치나 논문 원문 검증을 완료했다는 의미가 아니다. 아래 요약은 이전 WebFetch 응답에 기반하므로, 설계 근거로 확정하기 전에 원문을 다시 대조해야 한다.

## 출처와 중단 상태

- 이전 세션: `claude:/caaf7982-d90d-4d88-b776-f763ef5ce9d1`
- 재개 대화: `f2459c86-635e-43a5-b75f-6a3c9bc43b63`
- 리서치 기록: `f2459c86-635e-43a5-b75f-6a3c9bc43b63/subagents/agent-a4b44c67fc6d0ef5e.jsonl`
- 시작: 2026-09-14 14:45:36 KST.
- 마지막 응답: `2026-09-14T05:53:15.566Z` (14:53:15 KST), 레코드 88.
- 마지막 응답 내용: `API Error: Connection lost mid-response. The response above may be incomplete.`
- 수집 시도 33회 중 명시적 실패 20회, 그 외 응답 13회. 후자에도 로딩 화면·placeholder·검색 스니펫이 포함된다.
- 완료된 최종 브리프는 이 기록에 없다. 새 백그라운드 리서치를 이 복구 작업에서 시작하지 않았으므로 자동 완료 알림을 기다릴 상태도 아니다.

## 원래 요청의 범위

- 대표 페어링 패턴의 역할, 리듬, 적용 상황과 장단점 정리.
- 만족도, 참여, 학습·성장, 품질·생산성 근거를 구분하고 근거 수준 명시.
- 학습 가능한 다중 패턴 하네스에 노출할 3–4개 후보를 비교. 특히 Strong-Style과 Driver/Navigator 비교.
- 사람–사람 페어링을 사람–AI 페어링에 적용할 때 유지·수정·제외할 요소 정리.
- 출처 URL을 포함한 1,500단어 미만의 최종 브리프. 복구 당시 미제출.

## 현재까지 복구한 내용

| 패턴 | 기록에 남은 자료 | 현재 가능한 판단과 제한 |
|---|---|---|
| Driver/Navigator | 실무 가이드 요약: 레코드 41, 80 | 작성과 전략적 관찰의 역할 구분, 주기적 교대가 설명된다. 다른 패턴보다 성장·만족도가 높다는 비교 근거는 아직 없다. |
| Ping-Pong TDD | 실무 가이드 요약: 레코드 31, 41, 80 | 실패 테스트 → 상대의 구현 → 다음 실패 테스트로 교대하는 규칙이 있다. TDD에 적합한 작업이라는 전제가 있고, 균등한 시간 배분이나 학습 효과가 보장되는 것은 아니다. |
| Strong-Style | 제안자 글 요약: 레코드 12; 실무 가이드: 41, 80 | 아이디어를 다른 사람의 손을 통해 구현하는 원칙. 지식 전달에 대한 실무 경험은 있지만 초보자에게 항상 최적이라는 실험적 결론은 복구되지 않았다. 미세 통제·피로 위험도 검토해야 한다. |
| Mob / Swarming | Mob 사례·가이드: 레코드 32, 42, 72 | 팀 단위 공동 작업과 순환 참여 사례. Mob 사례만으로 Swarming의 동등성이나 1:1 사람–AI 페어링의 효과를 주장할 수 없다. |
| Unstructured / Expert–Expert | 일반 페어링에 대한 제한적 설명: 레코드 11, 61 | 독립 패턴으로서의 정의·성과 비교가 불충분하다. |
| Backseat Navigator / Tour Guide | 관련 URL 탐색 및 레코드 61, 80 | 확보된 가이드에 해당 명칭이 없거나 URL이 실패했다. 정의·효과를 확인한 것으로 취급하지 않는다. |

이 표는 순위표가 아니다. 앞선 제안서의 초기 3개 패턴은 계속 후보로 두되, 만족도·성장 기준의 최종 선정은 보류한다.

## 다시 확인할 주요 자료

- [Llewellyn Falco, Strong-Style Pairing](https://llewellynfalco.blogspot.com/2014/06/llewellyns-strong-style-pairing.html): 제안자의 정의·경험담. 원문 제안과 검증된 효과를 구분할 것.
- [On Pair Programming](https://martinfowler.com/articles/on-pair-programming.html): 실무 가이드. Driver/Navigator, Ping-Pong, Strong-Style, 상황별 전환을 설명한 요약이 남아 있다.
- [Tuple, Pair Programming Styles](https://tuple.app/pair-programming-guide/styles): 실무·제품 가이드. 세 가지 스타일의 설명이지 통제 실험이 아니다.
- [Agile Alliance, Mob Programming experience report](https://www.agilealliance.org/resources/experience-reports/mob-programming-agile2014/): 한 팀의 경험 보고. 생산성 수치를 일반적인 효과로 재사용하지 말 것.
- [Mob Programming Basics](https://mobprogramming.org/mob-programming-basics/): 팀 공동 작업 방식의 설명.
- [What is it like to program with artificial intelligence?](https://www.microsoft.com/en-us/research/publication/what-is-it-like-to-program-with-artificial-intelligence/): 복구 기록에는 초록·메타데이터만 있다. 사람–AI 페어링의 구체적 만족도·성장 실험 결과를 읽은 것으로 간주하지 않는다.

Wikipedia와 검색 스니펫은 원문을 찾기 위한 단서일 뿐이다. Hannay 등의 메타분석이나 참여 저하 연구를 실제로 읽었다고 기록하지 않는다.

## 수집 시도 전체 목록

레코드 번호는 위 리서치 JSONL 기준이다. 도구의 `is_error: false`만으로 성공을 판정하지 않고, 응답 본문의 403/404도 실패로 집계했다. 실패 URL은 출처가 아니라 재탐색용 기록이다.

| 레코드 | 요청 URL | 기록상 결과 |
|---|---|---|
| 9 | `https://collaboration.csc.ncsu.edu/laurie/Papers/XPSardinia.PDF` | ENOTFOUND |
| 10 | `https://blog.thecodewhisperer.com/permalink/the-basics-of-strong-style-pair-programming` | HTTP 404 |
| 11 | `https://en.wikipedia.org/wiki/Pair_programming` | 이전 도구 요약 응답 있음 |
| 12 | `https://llewellynfalco.blogspot.com/2014/06/llewellyns-strong-style-pairing.html` | 이전 도구 요약 응답 있음 |
| 18 | `https://simula.no/publications/effectiveness-pair-programming-meta-analysis` | HTTP 404 |
| 19 | `https://wiki.c2.com/?PairProgrammingPingPongPattern` | 로딩 페이지만 있음 |
| 21 | `https://oro.open.ac.uk/44215/` | HTTP 403 |
| 22 | `https://woodyzuill.com/2013/09/25/mob-programming/` | placeholder만 있음 |
| 27 | `https://www.researchgate.net/publication/222408325_The_Effectiveness_of_Pair_Programming_A_Meta-Analysis` | HTTP 403 |
| 30 | `https://www.inf.fu-berlin.de/inst/ag-se/pubs/Salinger_2013_understanding-pp_ESEM.pdf` | HTTP 404 |
| 31 | `https://martinfowler.com/articles/on-pair-programming.html` | 이전 도구 요약 응답 있음 |
| 32 | `https://en.wikipedia.org/wiki/Mob_programming` | 이전 도구 요약 응답 있음 |
| 36 | `https://www.sciencedirect.com/science/article/abs/pii/S0950584909000123` | HTTP 403 |
| 39 | `https://www.researchgate.net/publication/271429145_Disengagement_in_Pair_Programming_Does_It_Matter` | HTTP 403 |
| 41 | `https://martinfowler.com/articles/on-pair-programming.html` | 이전 도구 요약 응답 있음 |
| 42 | `https://mobprogramming.org/mob-programming-basics/` | 이전 도구 요약 응답 있음 |
| 46 | `https://dl.acm.org/doi/10.1016/j.infsof.2009.02.001` | HTTP 403 |
| 48 | `https://gist.github.com/ff/pair-programming-styles` | HTTP 404 |
| 51 | `https://www.microsoft.com/en-us/research/publication/what-is-it-like-to-program-with-artificial-intelligence/` | 초록·메타데이터만 있음 |
| 52 | `https://stackify.com/pair-programming-styles/` | TOOL_ERROR |
| 57 | `https://gist.github.com/lightyrs/e37b93ab63b25b0dcd76` | HTTP 404 |
| 60 | `https://www.simula.no/sites/default/files/publications/Simula.SE.186.pdf` | HTTP 404 |
| 61 | `https://www.freecodecamp.org/news/the-benefits-and-pitfalls-of-pair-programming-in-the-workplace-e68c3ed3c81f/` | 이전 도구 요약 응답 있음 |
| 62 | `https://scholar.google.com/scholar?q=Hannay+Dyba+Arisholm+effectiveness+pair+programming+meta-analysis` | 검색 스니펫만 있음 |
| 66 | `https://www.academia.edu/download/97072923/30.pdf` | HTTP 403 |
| 68 | `https://gist.github.com/sarahjohn/pair-programming-styles-b3f7d0a` | HTTP 404 |
| 70 | `https://www.researchgate.net/publication/220639257_Pair_programming_and_the_mysterious_role_of_the_navigator` | HTTP 403 |
| 72 | `https://www.agilealliance.org/resources/experience-reports/mob-programming-agile2014/` | 이전 도구 요약 응답 있음 |
| 76 | `https://hannay.name/publications/Hannay-Dyba-Arisholm-Sjoberg-2009-IST-The_effectiveness_of_pair_programming.pdf` | ENOTFOUND |
| 78 | URL 누락 | InputValidationError |
| 80 | `https://tuple.app/pair-programming-guide/styles` | 이전 도구 요약 응답 있음 |
| 84 | `https://thoughtbot.com/blog/pair-programming-styles` | HTTP 404 |
| 86 | `https://folk.idi.ntnu.no/dybaa/hannay-dyba-arisholm-sjoberg-ist-09.pdf` | HTTP 404 |

## 재개할 검증 작업

다음 목록은 복구 당시 남은 작업이다. 후속 브리프에서 핵심 근거의 대상·지표·한계를 대조하고 제품 제안을 분리했다. 초기 패턴과 구현 범위의 승인은 여전히 별도다.

1. Hannay 등 메타분석의 원문 또는 신뢰할 수 있는 저장소 사본을 찾아 서지정보·대상·효과 지표를 대조한다. 페어 대 솔로의 결과를 패턴 간 우열로 바꾸지 않는다.
2. 참여 저하, 역할 교대, 숙련도 차이를 다룬 관찰 연구의 실제 원문을 식별한다. 기존에 실패한 URL의 제목만으로 연구 결과를 채우지 않는다.
3. 만족도와 자기보고 학습을 실제 과제 성취·유지·전이 같은 성장 지표와 구분한다. 자료가 없으면 없다고 적는다.
4. Strong-Style의 학습 주장과 부담·통제 위험을 Driver/Navigator와 비교하되, 직접 비교 연구가 없다면 우열 미확정으로 남긴다.
5. 사람–AI 적용은 별도 가설로 표시하고, 3–4개 후보의 선정 이유·근거 수준·제한을 최종 브리프로 정리한다.

관련 문서: [인계 메모](../recovery/2026-09-14-session-handoff.md), [복구된 제안서 원문](../superpowers/specs/2026-09-14-pair-harness-rebuild-design.md).
