<div align="center">
  <img src="resources/icon.png" width="112" alt="PC Management Assistant 아이콘" />
  <h1>PC Management Assistant</h1>
  <p>시스템 상태를 한눈에 확인하고 AI의 도움으로 PC를 관리하는 Windows·macOS 데스크톱 앱</p>

  [![Latest Release](https://img.shields.io/github/v/release/setupmaru/PC-Management-Assistant?label=release)](https://github.com/setupmaru/PC-Management-Assistant/releases/latest)
  [![Desktop Release](https://github.com/setupmaru/PC-Management-Assistant/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/setupmaru/PC-Management-Assistant/actions/workflows/release-desktop.yml)
  ![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows)
  ![macOS](https://img.shields.io/badge/macOS-Intel%20%7C%20Apple%20Silicon-000000?logo=apple)
</div>

## 다운로드

빌드가 완료된 최신 버전은 [GitHub Releases](https://github.com/setupmaru/PC-Management-Assistant/releases/latest)에서 받을 수 있습니다.

| 운영체제 | 파일 | 용도 |
| --- | --- | --- |
| Windows x64 | `PC-Management-Assistant-*-setup.exe` | 일반 설치 프로그램 |
| Windows x64 | `PC-Management-Assistant-*-windows-portable.zip` | 설치 없이 실행하는 포터블 버전 |
| Apple Silicon Mac | `PC-Management-Assistant-*-mac-arm64.dmg` | M1 이상 Mac용 |
| Intel Mac | `PC-Management-Assistant-*-mac-x64.dmg` | Intel 프로세서 Mac용 |

> 현재 배포 파일에는 Windows 코드 서명과 Apple Developer ID 서명·공증이 적용되지 않았습니다. 운영체제의 보안 경고가 나타날 수 있으며, macOS에서는 Finder에서 앱을 Control-클릭한 뒤 **열기**를 선택해야 할 수 있습니다.

## 주요 기능

- **실시간 시스템 대시보드**: CPU, GPU, 메모리, 디스크, 네트워크 사용량 및 상위 프로세스 표시
- **GPU 모니터링**: 모델명, 사용률, VRAM 사용량, 온도 확인
- **네트워크 상세 감시**: 공유기·ISP·DNS·인터넷 구간 상태, 지연, 손실률 및 리포트 제공
- **부팅 최적화**: 시작 프로그램과 서비스의 부팅 지연 분석, 복원 지점 기반 변경 관리
- **Windows 관리**: 이벤트 로그 감시, DNS·시간 동기화·Windows Update 오류 자동 복구, 시스템 유지보수 상태 확인
- **AI 채팅**: 서버가 OpenAI API를 호출해 시스템 진단 질문과 이미지 첨부 지원
- **계정 기능**: 이메일 인증, 비밀번호 찾기, Free·Plus·Pro 플랜 및 Polar 결제 연동
- **자동 업데이트**: GitHub Releases에 게시된 새 데스크톱 버전 확인

## 운영체제별 지원 범위

| 기능 | Windows | macOS |
| --- | :---: | :---: |
| CPU·GPU·메모리·디스크·네트워크 | ✅ | ✅ |
| 상위 프로세스 및 AI 채팅 | ✅ | ✅ |
| 네트워크 상세 감시·리포트 | ✅ | — |
| 부팅 최적화·복원 관리 | ✅ | — |
| 이벤트 로그·안전 자동 복구·Windows Update·유지보수 | ✅ | — |

PowerShell과 Windows 관리 인터페이스가 필요한 기능은 Windows에서만 표시됩니다.

## 라이선스

이 프로젝트의 패키지 메타데이터에는 MIT 라이선스가 적용되어 있습니다.
