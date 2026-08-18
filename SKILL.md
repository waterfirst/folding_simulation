# Foldable Display Simulator Skill

## 목적

이 문서는 Foldable Display Mechanical Simulation을 유지보수하거나 같은 유형의 React/Three.js engineering simulator를 확장할 때 적용하는 지침입니다.

## 사용자 흐름

1. folding angle, 온도, 최소 힌지 반경, 패널 폭과 cycle을 설정합니다.
2. Layer별 두께, 25°C 탄성률과 허용 변형률을 입력합니다.
3. 3D view에서 패널, 지그, motor, load cell과 rod 동작을 확인합니다.
4. Layer별 stress/strain utilization과 folding/unfolding load를 비교합니다.
5. 조건을 저장·복원하거나 CSV로 내보냅니다.

## 파일 책임

- `src/App.jsx`: React 상태, UI, Three.js lifecycle과 interaction
- `src/simulation.js`: 순수 계산 함수, curve와 CSV 생성
- `src/styles.css`: 레이아웃, 컴포넌트 스타일과 responsive behavior
- `tests/`: 계산 모델의 단위·경계·단조성 회귀 테스트
- `deploy/`: Linux/Nginx 배포 설정

## 코딩 규칙

- 계산 함수는 가능한 한 순수 함수로 유지합니다.
- React state에는 직렬화할 수 있는 값만 저장합니다.
- Three.js 객체는 ref에 저장하고 unmount 시 geometry, material, renderer와 listener를 해제합니다.
- 변경과 관계없는 코드를 재작성하지 않습니다.
- 코드 주석은 짧은 영어로 작성합니다.
- UI의 모든 수치에는 단위를 표시합니다.
- Layer는 최대 10개로 제한합니다.

## 기계 모델 규칙

- 모든 내부 길이와 강성 계산은 명시적으로 mm, MPa, N 단위로 변환합니다.
- `baseHingeR`는 최대 제어 각도에서 도달하는 최소 반경입니다.
- 중립축은 `Σ(EAz)/Σ(EA)`로 계산합니다.
- 굽힘 강성은 각 Layer의 local inertia와 parallel-axis term을 모두 포함합니다.
- 최대 응력은 등가 탄성률이 아니라 각 Layer의 경계면 응력에서 구합니다.
- 위험도는 Layer별 허용 변형률 이용률로 판정합니다.
- 하중식에 패널 폭과 모멘트 암이 반드시 포함되어야 합니다.
- 새 경험계수는 근거, 단위, 적용 범위를 README에 기록합니다.

이 모델은 빠른 analytical estimate입니다. 계면 slip, 박리, 비선형 점탄성, 소성, 접촉 또는 대변형이 중요한 경우 FEA와 실측 검증을 연결합니다.

## Three.js 규칙

1. setup effect에서 geometry, material과 group을 생성합니다.
2. 업데이트에 필요한 객체만 ref에 보관합니다.
3. parameter effect에서는 position, rotation, scale과 color만 갱신합니다.
4. cleanup에서 모든 GPU resource와 DOM event listener를 해제합니다.

패널 중앙에 실제 제품에 없는 힌지 구조물을 추가하지 않습니다. 응력 색상은 FEA contour가 아니라 임계부 이용률을 전달하는 시각화임을 유지합니다.

## 완료 전 검증

```bash
npm test
npm run build
```

- 한글 인코딩이 UTF-8인지 확인합니다.
- 3D 장면과 외부 조명이 표시되는지 확인합니다.
- 좌클릭 회전, 중간/우클릭 이동과 휠 확대를 확인합니다.
- 최대 접힘에서 계산 반경이 `baseHingeR`인지 확인합니다.
- Layer 변경이 중립축, 강성, 임계 Layer와 3D 두께에 반영되는지 확인합니다.
- Loading/unloading point가 고정된 cycle envelope를 따르는지 확인합니다.
- 저장한 scenario가 parameter와 Layer를 모두 복원하는지 확인합니다.
- CSV의 property, result와 curve record가 서로 구분되는지 확인합니다.
- Docker build와 Linux CI가 성공하는지 확인합니다.

## Linux 실행

개발:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

운영 권장:

```bash
docker compose up -d --build
```

프로덕션에서는 Vite 개발 서버 대신 Docker Nginx 또는 호스트 Nginx의 정적 배포를 사용합니다.
