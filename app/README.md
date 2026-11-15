# 충전 길잡이 안드로이드 앱 (테스트)

`web/dist/index.html`(한 파일로 합친 웹 앱)을 Capacitor 7 로 감싼 안드로이드 앱. 앱 안에서는 화면이 `https://localhost` 로 열려 위치(GPS)를 쓸 수 있다.

## 테스트 APK 만들기 (저장소 루트에서)
```
bash app/build-apk.sh      # → app/dist/충전길잡이-test.apk (디버그 서명)
```
- 필요한 것: Node, JDK 21(`C:\Program Files\Android\openjdk\jdk-21.0.8`), Android SDK(`%LOCALAPPDATA%\Android\Sdk`: platform-tools, platforms;android-35, build-tools;35.0.0). `app/android/local.properties` 에 sdk.dir.
- 안드로이드 빌드 도구는 경로에 한글이 있으면 거부해서, `%LOCALAPPDATA%\ev-charge-build` 로 복사해 빌드하고 APK 만 가져온다.
- 처음 한 번: `cd app && npm install`

## 지금 상태
- 앱 ID `com.chargeguide.test` 는 임시. 스토어에 올리기 전에 정하고 바꾼다(올린 뒤엔 못 바꿈).
- 디버그 서명이라 스토어용이 아니다. 공개할 때 서명 키를 만들고 따로 보관한다(저장소에 넣지 않음).
- 위치 권한: ACCESS_COARSE/FINE_LOCATION, 앱을 열어 둔 동안만. 백그라운드 위치 없음.
- 인증키는 APK 에 들어가지 않는다(앱에서 처음 한 번 넣으면 폰에만 저장).
