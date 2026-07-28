# OSS Call Bridge

## Jettel local sync paketi

Jettel/Mornet santral bilgisi icin rep secimi sormayan paket:

```text
call-bridge/OSS-Jettel-Local-Sync-USB.zip
```

Bu zip'i rep bilgisayarina acin ve `KURULUM-JETTEL-BASLAT.bat` dosyasini yonetici olarak calistirin.

Not: `call-bridge/usb-package` eski MicroSIP/rep bazli pakettir; rep secimi sormasi normaldir. Jettel local sync icin onu kullanmayin.

MicroSIP çağrı olaylarını OSS Center'a gönderir. SIP hesabını veya Jettel santral yönlendirmelerini değiştirmez.

## Kurulum sırası

1. `supabase/CALL_BRIDGE_SETUP.sql` dosyasını Supabase SQL Editor'da çalıştırın.
2. `call-event` Edge Function'ını deploy edin.
3. Supabase Function Secrets içine güçlü bir `CALL_BRIDGE_SECRET` ekleyin.
4. USB paketinde `secret.txt` varsa kurulum onu okur; yoksa `CALL_BRIDGE_SECRET` kurulum sırasında gizli şekilde sorulur. `secret.txt` dosyasını repo'ya koymayın.
5. Her bilgisayarda kullanıcıya ait Supabase `profiles.id` değeriyle yönetici PowerShell açıp çalıştırın:

```powershell
.\install-oss-call-bridge.ps1 `
  -Endpoint "https://PROJECT.supabase.co/functions/v1/call-event" `
  -Secret "CALL_BRIDGE_SECRET" `
  -ProfileId "KULLANICI-PROFILE-UUID"
```

MicroSIP portable kullanılıyorsa `-MicroSipIni "C:\...\microsip.ini"` parametresini de verin. Kurulumdan sonra MicroSIP'i tamamen kapatıp yeniden açın.

Başarısız gönderimler `%LOCALAPPDATA%\OSSCallBridge\queue` altında bekler ve sonraki çağrı olayında yeniden denenir. Günlük hata kaydı `bridge.log` dosyasındadır.

## Rep listesine kişi ekleme

`usb-package/repler.csv` dosyasını Excel veya bir metin düzenleyiciyle açın. `Name,Email,ProfileId` başlık satırını değiştirmeden dosyanın sonuna yeni kişiyi ekleyin:

```csv
Ayşe Hanım,ayse@rep.com,11111111-2222-3333-4444-555555555555
```

Profile UUID henüz bilinmiyorsa alan boş bırakılabilir:

```csv
Ayşe Hanım,,
```

Kurulumda bu kişi seçildiğinde CRM/Supabase `profiles.id` değeri sorulur. İsim ve e-posta yalnızca seçim ekranı içindir; çağrının doğru rep hesabına yazılmasını sağlayan asıl değer `ProfileId` UUID'sidir.
