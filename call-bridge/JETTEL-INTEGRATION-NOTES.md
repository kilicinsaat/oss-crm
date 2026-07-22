# Jettel API entegrasyon notlari

Bu dosyaya canli API sifresi, token veya apicode yazilmaz. Bu degerler Supabase Function Secrets icinde tutulur.

## Mevcut durum

- MicroSIP olaylari `call-event` Edge Function'a gider.
- CRM bu olaylari `public.call_sessions` tablosundan canli okur.
- `supabase/JETTEL_CALL_INTEGRATION.sql` calistirilinca arama kayitlari icin Jettel alanlari eklenir:
  - `provider`
  - `external_call_id`
  - `caller_name`
  - `extension`
  - `transfer_target`
  - `recording_url`
  - `raw_event`

## Jettel tarafindan lazim olan bilgiler

Dokumandan su endpoint/fonksiyon isimleri netlesmeli:

- Arama gecmisi / CDR listesi endpoint'i
- Arama kaydi ses dosyasi endpoint'i veya recording URL alani
- Anlik gelen arama webhook destegi var mi
- Dahili listesini okuma endpoint'i
- Cagri yonlendirme ekleme/guncelleme endpoint'i
- Tarih filtreleme formati
- Sayfalama/limit formati

## Secrets

Supabase Function Secrets olarak tutulacaklar:

- `JETTEL_POST_URL`
- `JETTEL_USERNAME`
- `JETTEL_API_PASSWORD`
- `JETTEL_TOKEN`
- `JETTEL_APICODE`

## Ekranlardan netlesen santral yapisi

- Dahili havuzu: `101` - `110`
- Grup: `Default`
- Hat / gorunen numara: `902129030222`
- Dahili durum ekrani bagli/bagli degil bilgisini veriyor.
- Santral izleme ekrani aktif gorusmelerde dahili, sure, hat ve aranan/arayani gosteriyor.

Bu bilgi CRM tarafinda `public.jettel_extensions` tablosuna yazilir. Her dahili daha sonra bir CRM `profiles.id` ile eslenir. Boylece Jettel kaydi sadece `extension=107` diye gelirse bile CRM bunu ilgili rep hesabina baglayabilir.

## Onerilen akis

1. `JETTEL_CALL_INTEGRATION.sql` Supabase SQL Editor'da bir kez calistirilir.
2. Jettel dokumanindan arama gecmisi ve kayit endpoint'i netlestirilir.
3. Yeni bir `jettel-call-sync` Edge Function yazilir.
4. Function belirli araliklarla Jettel'den son aramalari ceker.
5. Gelen kayitlar `call_sessions.external_call_id` ile idempotent sekilde insert/update edilir.
6. CRM müşteri detayinda kayıt linki, arayan, dahili ve yonlendirme bilgisi otomatik gorunur.

## Cagri yonlendirme

Yonlendirme islemi dogrudan CRM'den yapilacaksa boss yetkili bir Edge Function gerekir. CRM frontend Jettel sifresini asla gormemeli; frontend sadece Supabase function'a "su dahiliyi su hedefe yonlendir" istegi atar, Jettel API cagrisi server tarafinda yapilir.
