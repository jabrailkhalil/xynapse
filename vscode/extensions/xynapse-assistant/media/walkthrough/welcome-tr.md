# Xynapse IDE'ye Hosgeldiniz

Xynapse IDE, yerlesik AI asistanli bir entegre gelistirme ortamidir.

## Ozellikler

- **AI Sohbet** — kod hakkinda sorular sorun, aciklamalar alin ve cozumler uretin
- **Otomatik Tamamlama** — editorde akilli oneriler (kabul etmek icin Tab)
- **Satir Ici Duzenleme** — kodu secin ve AI duzenleme icin `Ctrl+I` tuslayayin
- **Proje Baglami** — asistan kodunuzu, diff'i, terminali ve hatalari gorur
- **Council** — mimari kararlarin coklu ajan tartismasi (`/council`)
- **Rus Modelleri** — YandexGPT ve GigaChat icin yerlesik destek

## Verileriniz Guvendedir

Xynapse, IDE sunucularina veri gondermez. Tum API anahtarlari `~/.xynapse/config.yaml` icinde **yerel** olarak saklanir. Telemetri tamamen devre disi birakilmistir.

## Baslangic

1. Soldaki **Xynapse** panelini acin
2. `~/.xynapse/config.yaml` icinde modelleri yapilandirin
3. Sohbet icin `Ctrl+L`, duzenleme icin `Ctrl+I`, otomatik tamamlama icin `Tab` kullanin
