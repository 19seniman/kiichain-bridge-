# 🤖 KiiChain Daily Bot

Script Node.js untuk otomasi aktivitas harian di KiiChain Testnet Oro.

## Fitur
- ✅ **Cek saldo & status wallet** — tampilkan balance KII dan info network
- ✅ **Self-transfer harian** — kirim KII kecil ke diri sendiri untuk membangun wallet footprint
- ✅ **Request faucet otomatis** — klaim token testnet setiap 24 jam
- ✅ **Jadwal otomatis** — berjalan setiap hari jam 08:00 WIB via cron

---

## Instalasi

```bash
# 1. Install dependencies
npm install

# 2. Buat file .env dari template
cp .env.example .env

# 3. Edit file .env, isi private key kamu
nano .env
```

Isi `.env`:
```
PRIVATE_KEY=private_key_kamu_disini
TRANSFER_AMOUNT=0.0001
CRON_SCHEDULE=0 8 * * *
```

> ⚠️ **JANGAN pernah share file .env atau private key kamu ke siapapun!**

---

## Cara Pakai

```bash
# Jalankan bot terjadwal (mulai sekarang + cron harian jam 08:00)
node index.js

# Jalankan semua tugas SEKARANG (tanpa menunggu jadwal)
node index.js --now

# Hanya cek saldo wallet
node index.js --check

# Hanya request faucet
node index.js --faucet

# Hanya self-transfer
node index.js --transfer
```

---

## Konfigurasi Jaringan

| Parameter | Value |
|-----------|-------|
| Network   | KiiChain Testnet Oro |
| Chain ID  | 1336 |
| RPC       | https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/ |
| Symbol    | KII |
| Explorer  | https://explorer.kiichain.io |

---

## Mendapatkan Token Testnet (Manual)

Jika faucet API tidak berhasil, klaim manual:
1. **Explorer**: https://explorer.kiichain.io/faucet
2. **Discord**: https://discord.gg/kiichain → channel `#faucet`
   - Ketik: `$request 0xAlamat_kamu`

---

## Menjalankan 24/7 dengan PM2

```bash
# Install PM2
npm install -g pm2

# Jalankan bot
pm2 start index.js --name kiichain-bot

# Lihat log
pm2 logs kiichain-bot

# Auto-start saat reboot
pm2 startup
pm2 save
```

---

## ⚠️ Keamanan

- Simpan private key hanya di file `.env` lokal
- File `.env` sudah ada di `.gitignore` — jangan pernah di-commit ke Git
- Gunakan wallet khusus testnet, bukan wallet utama kamu
