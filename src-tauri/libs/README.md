# WebView2 Loader

`WebView2Loader.dll` is the Microsoft x64 redistributable shipped by
`webview2-com-sys` 0.38.2. Rust's Windows GNU target links this loader
dynamically, so the Tauri NSIS package must install it beside `nexo.exe`.

Source used for this build:

`webview2-com-sys-0.38.2/x64/WebView2Loader.dll`
