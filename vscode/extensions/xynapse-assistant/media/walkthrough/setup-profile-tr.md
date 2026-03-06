# Xynapse Profilinizi Olusturun

Xynapse profiliniz yerel bir hesaptir. Ucuncu taraf sunucularda kayit gerekmez.

## Profil nasil olusturulur

1. Komut paletini acin: `Ctrl+Shift+P`
2. Yazin: **Xynapse: Set Up Profile**
3. Adinizi ve e-postanizi girin

Profil `~/.xynapse/profile.json` dosyasina kaydedilir ve git commitlerinde ve asistan loglarinda kimlik dogrulama icin kullanilir.

## Sifreli yedekleme

Tum ayarlarinizi ve API anahtarlarinizi sifreli bir dosyaya aktarabilirsiniz:

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. Bir sifreleme parolasi girin
3. `.enc` dosyasini kaydedin

Baska bir bilgisayarda geri yuklemek icin:
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. Dosyayi secin ve parolayi girin

## Git ile senkronizasyon

Sifreli yapilandirmayi kendi git deponuza gonderebilirsiniz:
- **Push**: `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

Dosya AES-256-GCM ile sifrelenir — herkese acik bir depoda bile guvenlidir.
