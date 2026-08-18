# Foldable Display Mechanical Simulation

[![CI](https://github.com/waterfirst/folding_simulation/actions/workflows/ci.yml/badge.svg)](https://github.com/waterfirst/folding_simulation/actions/workflows/ci.yml)

React와 Three.js로 만든 폴더블 디스플레이 적층 구조의 접힘 하중·응력 비교 시뮬레이터입니다. Layer 두께, 탄성률, 허용 변형률, 온도, 최소 힌지 반경과 누적 사이클을 바꾸면서 3D 시험기 동작과 Layer별 기계 응답을 실시간으로 확인할 수 있습니다.

> 이 도구는 적층 보 이론을 이용한 빠른 engineering estimate입니다. 재료 비선형, 계면 slip·박리, 접촉 및 대변형을 직접 푸는 FEA를 대체하지 않습니다. 절대값을 설계 승인에 사용하려면 실측 하중과 FEA 결과로 계수를 보정해야 합니다.

## 주요 기능

- 0–85° 편측 folding/unfolding 애니메이션과 누적 cycle 반영
- 마우스 회전, 중간/우클릭 이동, 휠 확대
- 최대 10개 Layer의 두께, 25°C 탄성률, 허용 변형률 편집
- 소재별 온도 탄성률 보정
- E-weighted 중립축과 단위 폭당 굽힘 강성 계산
- Layer별 인장·압축 변형률, 응력, 허용값 이용률 계산
- Critical Layer 기반 PASS/WATCH/FAIL 판정
- 패널 폭과 42 mm 모멘트 암을 반영한 folding/unfolding load
- 고정된 최대 접힘 envelope 기반 stress-strain hysteresis 표시
- 프리셋, 조건 저장·복원, UTF-8 CSV 내보내기
- Docker, Nginx, GitHub Actions Linux 배포 구성

## 빠른 실행 — Docker 권장

Linux 노트북에 Git과 Docker Engine이 설치되어 있다면 다음 명령으로 실행할 수 있습니다.

```bash
git clone https://github.com/waterfirst/folding_simulation.git
cd folding_simulation
docker compose up -d --build
```

같은 노트북에서는 `http://localhost:8080`, 같은 가정 내 네트워크에서는 `http://노트북_IP:8080`으로 접속합니다.

Ubuntu 방화벽을 사용한다면 LAN 접속용 포트를 엽니다.

```bash
sudo ufw allow 8080/tcp
```

상태와 로그는 다음과 같이 확인합니다.

```bash
docker compose ps
docker compose logs -f
```

종료와 재시작:

```bash
docker compose down
docker compose up -d
```

## Node.js로 직접 실행

Node.js 18.18 이상이 필요하며 Node.js 20 LTS를 권장합니다.

```bash
git clone https://github.com/waterfirst/folding_simulation.git
cd folding_simulation
npm install
npm test
npm run build
npm run preview -- --host 0.0.0.0 --port 5174
```

브라우저에서 `http://노트북_IP:5174`로 접속합니다. 개발 서버는 다음 명령입니다.

```bash
npm run dev -- --host 0.0.0.0 --port 5174
```

`npm run dev`와 `vite preview`는 개발·검증용입니다. 장기간 운영에는 Docker 또는 Nginx 정적 배포를 사용하십시오.

## 호스트 Nginx 정적 배포

```bash
npm install
npm test
npm run build
sudo mkdir -p /var/www/folding-simulation
sudo cp -a dist/. /var/www/folding-simulation/
sudo cp deploy/nginx-site.conf /etc/nginx/sites-available/folding-simulation
sudo ln -s /etc/nginx/sites-available/folding-simulation /etc/nginx/sites-enabled/folding-simulation
sudo nginx -t
sudo systemctl reload nginx
```

기본 예시는 5174 포트를 사용합니다. 이미 사용 중인 포트가 있다면 `deploy/nginx-site.conf`의 `listen` 값을 변경합니다.

인터넷에서 접속할 계획이면 개발 서버를 직접 노출하지 말고, VPN 또는 HTTPS reverse proxy와 접근 제어를 구성하십시오.

## 계산 모델

Layer `i`의 온도 보정 탄성률과 중립축은 다음 구조로 계산합니다.

```text
E_i(T) = E_i(25°C) × exp[-c_i(T - 25)]
z_NA   = Σ(E_i A_i z_i) / Σ(E_i A_i)
D      = Σ E_i [I_i + A_i(z_i - z_NA)²]
```

최대 제어 각도에서 곡률 반경이 입력한 최소 힌지 반경과 일치하도록 정의했습니다.

```text
κ(θ)   = sin[(π/2)(θ/85°)] / R_min
ε_i    = (z_i - z_NA)κ + ε_residual
σ_i    = E_i(T)ε_i
M      = D × panel_width × κ
F      = M / 42 mm + fixture loss
```

각 Layer의 이용률은 `|ε_i| / ε_allowable,i`이며, 최대 이용률로 판정합니다.

| 이용률 | 판정 |
|---:|---|
| `< 0.75` | PASS |
| `0.75–1.00` | WATCH |
| `≥ 1.00` | FAIL |

기본 허용 변형률과 온도계수는 비교용 초기값입니다. 실제 제품의 UTG 강화 조건, POL 구조, OCA DMA 결과와 필름 방향성에 맞춰 수정해야 합니다.

## 검증

```bash
npm test
npm run build
```

테스트는 기본 적층 두께, 온도별 소재 반응, 최소 반경 보존, 반경-변형률 단조성, 하중 범위, Thin Stack 프리셋, cycle damage와 CSV 구조를 확인합니다. GitHub Actions에서도 Ubuntu/Node 20 환경으로 동일한 테스트와 빌드를 실행합니다.

## 디렉터리

```text
src/
├── App.jsx          # React UI와 Three.js 장면
├── main.jsx         # React 진입점
├── simulation.js    # 적층·응력·하중·피로 계산
└── styles.css       # 대시보드와 반응형 레이아웃
tests/               # Node 내장 test runner 계산 검증
deploy/              # Docker/호스트 Nginx 설정
.github/workflows/   # Linux CI
```

## 제작자

개발품질그룹 최낙초 프로 · 2026

MIT License
