# OSS Call Bridge

MicroSIP çağrı olaylarını OSS Center'a gönderir. SIP hesabını veya Jettel santral yönlendirmelerini değiştirmez.

## Kurulum sırası

1. `supabase/CALL_BRIDGE_SETUP.sql` dosyasını Supabase SQL Editor'da çalıştırın.
2. `call-event` Edge Function'ını deploy edin.
3. Supabase Function Secrets içine güçlü bir `CALL_BRIDGE_SECRET` ekleyin.
4. Her bilgisayarda kullanıcıya ait Supabase `profiles.id` değeriyle yönetici PowerShell açıp çalıştırın:

```powershell
.\install-oss-call-bridge.ps1 `
  -Endpoint "https://PROJECT.supabase.co/functions/v1/call-event" `
  -Secret "CALL_BRIDGE_SECRET" `
  -ProfileId "KULLANICI-PROFILE-UUID"
```

MicroSIP portable kullanılıyorsa `-MicroSipIni "C:\...\microsip.ini"` parametresini de verin. Kurulumdan sonra MicroSIP'i tamamen kapatıp yeniden açın.

Başarısız gönderimler `%LOCALAPPDATA%\OSSCallBridge\queue` altında bekler ve sonraki çağrı olayında yeniden denenir. Günlük hata kaydı `bridge.log` dosyasındadır.
