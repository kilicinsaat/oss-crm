# Jettel API entegrasyon notlari

Bu dosyaya canli API sifresi, token veya apicode yazilmaz. Bu degerler Supabase Function Secrets icinde tutulur.

## Mevcut durum

- MicroSIP olaylari `call-event` Edge Function'a gider.
- CRM bu olaylari `public.call_sessions` tablosundan canli okur.
- `supabase/JETTEL_CALL_INTEGRATION.sql` calistirilinca arama kayitlari icin Jettel alanlari eklenir:
  - `provider`
  - `external_call_id`
  - `call_uuid`
  - `caller_name`
  - `extension`
  - `transfer_target`
  - `recording_url`
  - `recording_storage_path`
  - `recording_fetched_at`
  - `recording_error`
  - `waiting_seconds`
  - `raw_event`
- `jettel-api` Edge Function Jettel Yonetici API isteklerini server tarafindan atar.
- Jettel API sonuc ve hatalari `public.jettel_action_logs` tablosuna yazilir.

## Jettel PDF'lerinden netlesen fonksiyonlar

Endpoint formati:

```txt
POST https://vip.jettel.com.tr/api/v1.php?mode=FonksiyonAdi
Content-Type: application/x-www-form-urlencoded
```

Ortak alanlar:

```txt
token=...
apicode=...
username=admin-pbx349
password=...
```

Desteklenen ana fonksiyonlar:

- `ActiveCalls`: O anki aktif cagri/dahili bilgisini verir.
- `ExtensionStatus`: Dahili bagli/bagli degil, IP ve cihaz durumunu verir.
- `CallReport`: Arama gecmisini verir. Tarih araligi genel sorguda en fazla 24 saat olmali.
- `PlayRecord`: `callID` veya `call_uuid` ile ses kaydini base64 `wav` olarak verir.
- `CallBack`: Belirli dahili uzerinden musteriyi aratir.
- `ExtensionQueuesCallStatus`: Dahiliyi kuyruk aramalarinda durdurur/devam ettirir.
- `ExtensionDNDStatus`: Dahili rahatsiz etmeyin durumunu acar/kapatir.
- `TwoWayCallback`: Iki dis numara arasinda callback baslatir.
- `SpyCall`: Dinleme/fisilti/dahil olma. Guvenlik sebebiyle CRM'de varsayilan kapali tutulur.

## CRM `jettel-api` action formatlari

Frontend veya manuel testte Supabase Function'a su body'ler gonderilir:

```json
{ "action": "extension-status" }
```

```json
{ "action": "active-calls" }
```

```json
{
  "action": "call-report",
  "firstDay": "2026-07-23 00:00:00",
  "lastDay": "2026-07-23 23:59:59",
  "type": "",
  "caller": "",
  "called": "",
  "status": ""
}
```

```json
{
  "action": "callback",
  "extension": "101",
  "phone": "05321234567"
}
```

```json
{
  "action": "play-record",
  "callId": "123456"
}
```

```json
{
  "action": "queue-call-status",
  "extension": "101",
  "status": "1"
}
```

```json
{
  "action": "dnd-status",
  "extension": "101",
  "status": "0"
}
```

```json
{
  "action": "two-way-callback",
  "sourceNumber": "05321234567",
  "destinationNumber": "05329876543",
  "trunkCallerID": "902129030222",
  "callDuration": 60,
  "voiceRecord": 1
}
```

## Secrets

Supabase Function Secrets olarak tutulacaklar:

- `JETTEL_BASE_URL` = `https://vip.jettel.com.tr`
- `JETTEL_USERNAME`
- `JETTEL_PASSWORD`
- `JETTEL_TOKEN`
- `JETTEL_APICODE`
- `JETTEL_PBX_SUFFIX` = `pbx349`
- `JETTEL_DEFAULT_TRUNK_CALLER_ID` = `902129030222`
- `JETTEL_ENABLE_SPY_CALL` = `true` sadece audit/izin kurallari hazirsa.

## Ekranlardan netlesen santral yapisi

- Dahili havuzu: `101` - `110`
- Grup: `Default`
- Hat / gorunen numara: `902129030222`
- Dahili durum ekrani bagli/bagli degil bilgisini veriyor.
- Santral izleme ekrani aktif gorusmelerde dahili, sure, hat ve aranan/arayani gosteriyor.

Bu bilgi CRM tarafinda `public.jettel_extensions` tablosuna yazilir. Her dahili daha sonra bir CRM `profiles.id` ile eslenir. Boylece Jettel kaydi sadece `extension=107` diye gelirse bile CRM bunu ilgili rep hesabina baglayabilir.

## Onerilen akis

1. `JETTEL_CALL_INTEGRATION.sql` Supabase SQL Editor'da bir kez calistirilir.
2. Supabase Function Secrets'a Jettel bilgileri girilir.
3. `jettel-api` Edge Function deploy edilir.
4. Boss panelde Rep Takip Merkezi > Dahili Yonetimi ekranindan rep-dahili eslesmeleri yapilir.
5. `extension-status` ile dahili baglanti durumu canli yenilenir.
6. `call-report` periyodik calistirilirse Jettel arama gecmisi `call_sessions` tablosuna islenir.
7. CRM musteri detayinda arama gecmisi, arayan/aranan, dahili, sure ve kayit bilgisi gorunur.

## Cagri yonlendirme

Yonlendirme islemi dogrudan CRM'den yapilacaksa boss yetkili bir Edge Function gerekir. CRM frontend Jettel sifresini asla gormemeli; frontend sadece Supabase function'a "su dahiliyi su hedefe yonlendir" istegi atar, Jettel API cagrisi server tarafinda yapilir.

## Turkiye IP zorunlulugu

Jettel/Mornet bilgisine gore `vip.jettel.com.tr` adresine Turkiye disindan gelen POST istekleri timeout alir. Supabase Edge Function yurtdisi cikisli oldugu icin Jettel API'ye dogrudan ulasamayabilir.

Bu durumda iki saglam cozum vardir:

1. Turkiye lokasyonlu VPS uzerinde local sync calistirmak.
2. Ofiste/sirket bilgisayarinda `jettel-local-sync.ps1` calistirmak.

VPS, internette 7/24 acik duran kiralik kucuk bir bilgisayardir. Turkiye lokasyonlu VPS kullanilirsa Jettel API istekleri Turkiye IP ile gider ve CRM bilgisayar acik olmasa bile sync devam eder.

Ofis PC cozumunde ise PC acik ve internet baglantisi varken sync otomatik calisir. `install-jettel-local-sync.ps1` Windows Gorev Zamanlayici'ya bir arka plan gorevi ekler; kullanici elle butona basmaz.

Kurulum:

```powershell
.\call-bridge\install-jettel-local-sync.ps1
```

Script su bilgileri sorar:

- `JETTEL_USERNAME`
- `JETTEL_PASSWORD`
- `JETTEL_TOKEN`
- `JETTEL_APICODE`
- `CALL_BRIDGE_SECRET`

Sonra her 30 saniyede bir `ExtensionStatus` bilgisini Jettel'den Turkiye IP uzerinden ceker ve `jettel-bridge-ingest` Edge Function'a gonderir. CRM ekrani `jettel_extensions` tablosunu canli okudugu icin bagli/bagli degil durumu otomatik guncellenir.
