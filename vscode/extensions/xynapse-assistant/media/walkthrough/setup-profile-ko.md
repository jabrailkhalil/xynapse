# Xynapse 프로필 만들기

Xynapse 프로필은 로컬 계정입니다. 타사 서버에 등록할 필요가 없습니다.

## 프로필 만드는 방법

1. 명령 팔레트 열기: `Ctrl+Shift+P`
2. 입력: **Xynapse: Set Up Profile**
3. 이름과 이메일 입력

프로필은 `~/.xynapse/profile.json`에 저장되며 git 커밋과 어시스턴트 로그에서 식별에 사용됩니다.

## 암호화 백업

모든 설정과 API 키를 암호화 파일로 내보낼 수 있습니다:

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. 암호화 비밀번호 입력
3. `.enc` 파일 저장

다른 컴퓨터에서 복원:
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. 파일 선택 후 비밀번호 입력

## Git을 통한 동기화

암호화된 구성을 git 저장소에 푸시할 수 있습니다:
- **Push**: `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

파일은 AES-256-GCM으로 암호화되어 공개 저장소에서도 안전합니다.
