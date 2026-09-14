# 페어링 패턴 — 초기 설계용 근거 브리프

**2026-09-14 / 초기 브리프 완료 / 제품 제안은 사용자 승인 전.**

범위: 중단된 [수집 기록](2026-09-14-pair-programming-recovered-notes.md)의 핵심 질문을 논문 원문과 제안자·실무자의 글로 보완했다. 체계적·전수 문헌고찰이나 최신 연구 전체를 망라한 보고서는 아니다. 실험, 관찰, 실무 경험, 제품 가설을 구분한다. 사람–사람 결과를 사람–AI 효과로 그대로 옮기지 않는다.

## 1. 패턴과 적용 조건

| 패턴 | 역할·리듬 | 적합한 상황과 주의점 | 근거 종류 |
|---|---|---|---|
| Driver/Navigator | 한쪽은 현재 작은 목표를 구현하고, 다른 쪽은 방향·오류·다음 단계를 함께 검토한다. 역할을 교대한다. | 일반 개발·탐색의 출발점. Navigator가 사후 리뷰어로 밀려나거나 매 동작을 지시하지 않게 한다. | 실무 가이드 [8], 실제 역할 전환 관찰 [3] |
| Strong-Style | 아이디어를 낸 쪽이 Navigator가 되어 상대의 손으로 구현한다. 안내의 추상도를 상대에게 맞춘다. | 지식 전달을 위한 선택지. 과도한 미세 지시·피로에 주의한다. 초보자에게 항상 최적이라는 비교 실험은 아니다. | 제안자의 경험 [7], 실무 가이드 [8] |
| Ping-Pong TDD | A의 실패 테스트 → B의 구현 → 공동 리팩터링 → B의 다음 실패 테스트로 교대한다. | 신뢰할 수 있는 테스트와 명확한 요구가 있는 작업. 탐색·UI 작업에 억지로 적용하지 않는다. 교대 규칙이 시간 균등이나 학습을 보장하지 않는다. | 실무 가이드 [8] |
| Mob | 여러 사람이 같은 작업을 함께 진행한다. | 팀 단위 지식 공유 사례다. Swarming과 동의어로 취급하거나 1인–AI 효과로 일반화하지 않는다. | 팀 경험 보고 [9] |

Expert–Expert는 참여자 구성이지 별도 교대 규칙이 아니다. Unstructured, Backseat Navigator, Tour Guide는 이번 확인 범위에서 독립 제품 모드의 정의·비교 근거가 충분하지 않아 초기 후보에서 보류한다.

## 2. 만족도·참여·성장·생산성을 분리한 근거

- **품질·시간·노력 — Hannay 등(2009), 메타분석 [1].** 페어 대 솔로에서 품질·완료 시간의 이점과 총 투입 노력의 비용이 나타나지만, 과제 복잡성·연구 간 차이와 출판 편향 문제가 있다. 세 가지 스타일의 직접 비교도, 학습 우월성의 검증도 아니다.
- **자신감·즐거움·학업 지속 — McDowell 등(2006), 교육 현장 비교 [2].** 입문 과목 학생 554명의 자료에서 페어링 집단의 자신감·즐거움·과제 품질·학업 지속에 긍정적 결과가 있었다. 과목을 끝낸 학생들의 개인 기말시험 평균에는 유의한 차이가 없었다. 무작위 개인 배정 실험이 아니며 분반·과제 차이가 있다. 여기서 retention은 기억 유지가 아니라 수강·전공 지속이다.
- **참여와 교대 — Plonka 등(2011), 현장 관찰 [3].** 전문 개발자의 21개 세션에서 키보드 사용은 불균등했고, 입력하지 않고 대화하는 시간과 다양한 교대가 있었다. 타이핑 비율만으로 참여·성장을 평가하거나 특정 타이머를 최적이라고 정할 근거는 아니다.
- **관찰과 이탈 — Plonka 등(2012), 질적 연구 [4].** 합의된 일시적 비참여와 설명을 따라가지 못하는 해로운 이탈을 구분한다. 조용히 보는 사람을 언제나 안티패턴으로 분류해서는 안 되지만, 학습이 목표인데 이해를 잃은 상태도 방치하면 안 된다.
- **지식 전달 — Plonka 등(2015), 상호작용 분석 [5].** 전문가의 직접 안내·질문·힌트·시연 등 서로 다른 지원 전략을 관찰했다. 안내 조절을 설계할 단서는 되지만, 특정 스타일의 장기 학습 우월성을 입증하지 않는다. 관련 현장 연구의 관찰 자료가 겹칠 수 있으므로 독립 실험 여러 건처럼 합산하지 않는다.
- **사람–AI 학습 — Shen·Tamkin(2026), 무작위 실험 [6].** Python 경험이 있지만 Trio는 처음인 52명이 참여했다. AI 집단의 직후 평가 평균은 약 50%, 비사용 집단은 67%로 약 17%p 차이였고, 완료 시간 차이는 통계적으로 유의하지 않았다. 낯선 라이브러리·짧은 과제·채팅형 AI라는 조건이며 장기 역량이나 모든 AI 도구로 일반화할 수 없다. 개념 질문·설명 요청과 전면 위임의 차이는 사후 관찰 분류이지, 각 사용 패턴을 무작위 배정한 인과 검증이 아니다.

**결론:** 이번 탐색에서는 Driver/Navigator, Strong-Style, Ping-Pong의 만족도·장기 성장에 보편적 우열을 매길 직접 비교 근거를 찾지 못했다. 자신감, 시험 성취, 작업 속도, 키보드 사용량은 서로 다른 지표다. 따라서 아래 순서는 연구 성적표가 아니라 제품 적합성에 따른 제안이다.

## 3. 제품 우선순위 제안

1. **Driver/Navigator를 기본값으로.** 브레인스토밍부터 구현까지 작은 공동 목표와 자연스러운 교대를 같은 방식으로 지원한다. 가장 효과적이라고 입증되어서가 아니라 사용자가 원하는 범위를 가장 적은 제약으로 다루기 때문이다.
2. **Guided Pairing을 선택 모드로.** Strong-Style에서 착안하되 사람 또는 AI가 안내할 수 있게 한다. 짧은 시연·직접 시도·회고를 조합하고 지원을 줄여 가는 제품 가설이다. 원형 Strong-Style과 동일한 방식이라고 부르지 않는다.
3. **Ping-Pong TDD를 조건부 선택 모드로.** 테스트가 적합할 때 명시적 교대 리듬을 경험한다. AI가 테스트와 구현을 모두 끝내고 나중에 사람에게 넘기는 방식으로 바꾸지 않는다.

Mob은 초기 1인–AI 범위 밖으로 둔다. 숙련자끼리의 유연한 협업은 기본 모드의 안내 강도로 표현한다. 세 모드에 독립 엔진을 만들기보다 하나의 세션·편집 제어 위에 규칙을 얹는 안을 권한다.

## 4. 사람–AI 적용에서 유지·수정·제외

- **유지:** 공동 목표, 진행 중 설명·질문, 상호 검토, 의미 있는 단위의 손 바꿈. 사람–AI는 사람–사람 페어링과 동일한 관계가 아니라는 점을 전제로 한다 [10].
- **수정:** AI는 합의된 작업 단위에서 실제 파일을 편집한다. 한 단위는 여러 파일일 수 있다. 사람은 언제든 질문·중지·인수를 요청할 수 있고, AI의 제안은 편집 권한 자체가 아니다. 이는 제품 안전·상호작용 가설이다.
- **제외:** 초보자에게 특정 모드 강제, AI 안내에 대한 맹신, 50:50 타이핑 할당, 무응답을 실력 부족으로 단정, 매 턴 의무 퀴즈. 대신 동의한 시점의 설명·변형 과제로 이해를 확인하는 방향을 제안한다 [3–8].
- **검증할 것:** 자연스러움·피로·주도권, 도움 없이 설명·변형·디버깅하는 능력, 결과 품질·시간을 각각 본다. 장기 성장은 동의한 후속 평가가 필요하다. 프로필의 자동 실력 판정 정확도나 세 모드의 효과는 아직 검증하지 않았다.

## 참고자료

연도는 논문·원문 기준이다. 검색 결과의 크롤링 날짜를 발행일로 사용하지 않았다. 연구 요약은 각 자료의 본문을 대조했으며, [7–9]는 실무 경험이지 효과 검증 실험이 아니다.

1. Hannay, Dybå, Arisholm, Sjøberg (2009). *The effectiveness of pair programming: A meta-analysis*. Information and Software Technology 51, 1110–1122. [원문 사본](https://www.ic.unicamp.br/~wainer/outros/systrev/30.pdf).
2. McDowell, Werner, Bullock, Fernald (2006). *Pair programming improves student retention, confidence, and program quality*. Communications of the ACM 49(8), 90–95. [논문 전문](https://www.researchgate.net/publication/220422564_Pair_programming_improves_student_retention_confidence_and_program_quality).
3. Plonka, Segal, Sharp, van der Linden (2011). *Collaboration in Pair Programming: Driving and Switching*. XP 2011, 43–59. [기관 저장소 원문](https://oro.open.ac.uk/28909/1/XP2011PlonkaSegalSharpVanderLinden.pdf).
4. Plonka, Sharp, van der Linden (2012). *Disengagement in pair programming: Does it matter?* ICSE 2012. [논문 전문](https://www.researchgate.net/publication/254041569_Disengagement_in_pair_programming_Does_it_matter).
5. Plonka, Sharp, van der Linden, Dittrich (2015). *Knowledge transfer in pair programming: An in-depth analysis*. International Journal of Human-Computer Studies 73, 66–78. [기관 저장소 원고](https://oro.open.ac.uk/41032/8861/41032ORO.pdf), [서지정보](https://pure.itu.dk/en/publications/knowledge-transfer-in-pair-programming-an-in-depth-analysis/).
6. Shen, Tamkin (2026). *How AI Impacts Skill Formation*. arXiv:2601.20245v1, 2026-01-28 제출. [논문](https://arxiv.org/html/2601.20245v1), [연구진 설명](https://www.anthropic.com/research/AI-assistance-coding-skills). 즉시 평가 결과이며 장기 추적 연구가 아니다.
7. Falco (2014). *Llewellyn’s strong-style pairing*. [제안자 원문](https://llewellynfalco.blogspot.com/2014/06/llewellyns-strong-style-pairing.html).
8. Böckeler, Siessegger (2020-01-15). *On Pair Programming*. [실무 가이드](https://martinfowler.com/articles/on-pair-programming.html). 게시 사이트 운영자 Martin Fowler가 아니라 두 실무자가 작성했다.
9. Zuill (2014). *Mob Programming — A Whole Team Approach*. Agile 2014 경험 보고. [원문](https://www.agilealliance.org/resources/experience-reports/mob-programming-agile2014/).
10. Sarkar 등 (2022). *What is it like to program with artificial intelligence?* [논문](https://www.microsoft.com/en-us/research/uploads/prod/2022/08/sarkar_2022_programming_AI.pdf). AI 프로그래밍의 개념·경험 분석이며 세 스타일의 통제 비교가 아니다.
