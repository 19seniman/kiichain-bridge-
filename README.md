# 🔗 KiiChain Staking + Faucet Script

Script Node.js lengkap untuk berinteraksi dengan jaringan **KiiChain Testnet Oro** — mencakup fitur staking (delegate, undelegate, redelegate, klaim reward) dan klaim token testnet via **website** maupun **Discord bot**.

---

## 📋 Daftar Fitur

| # | Fungsi | Deskripsi |
|---|--------|-----------|
| 1 | `checkBalance` | Cek saldo wallet |
| 2 | `getValidators` | Daftar 20 validator aktif beserta komisi |
| 3 | `getDelegations` | Lihat delegasi aktif milik wallet |
| 4 | `getRewards` | Lihat reward staking yang belum diklaim |
| 5 | `delegate` | Stake token KII ke validator |
| 6 | `undelegate` | Unstake token dari validator (unbonding ~21 hari) |
| 7 | `redelegate` | Pindahkan stake ke validator lain |
| 8 | `claimRewards` | Klaim semua reward staking sekaligus |
| 9 | `claimFaucetWeb` | Klaim 2.500 KII testnet via website |
| 10 | `claimFaucetDiscord` | Klaim 2.500 KII testnet via Discord bot |

---

## 🧰 Persyaratan

- **Node.js** versi 18 ke atas
- **npm** versi 8 ke atas
- Akun Discord (untuk fitur faucet Discord)
- Wallet KiiChain (address `kii1...`) dengan private key dalam format hex

---

## 📦 Instalasi

### 1. Clone atau download file

```bash
# Jika menggunakan git
git clone https://github.com/19seniman/kiichain-bridge-.git
cd kiichain-staking
```

Atau cukup taruh file `kiichain-staking.js` di folder baru:

```bash
mkdir kiichain-staking
cd kiichain-staking
# Letakkan kiichain-staking.js di sini
```

### 2. Install dependencies

```bash
npm init -y
npm install @cosmjs/stargate @cosmjs/proto-signing discord.js dotenv
```

### 3. Buat file `.env`

```bash
touch .env
```

Isi file `.env` dengan konfigurasi berikut:

```env
# ── WAJIB ─────────────────────────────────────────────
# Private key wallet KiiChain dalam format hex (64 karakter)
# Boleh dengan atau tanpa prefix "0x"
KIICHAIN_PRIVATE_KEY=0xabc123def456...

# ── UNTUK FAUCET DISCORD (opsional) ───────────────────
# Token bot Discord kamu
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# ID channel #faucet di server Discord KiiChain
DISCORD_FAUCET_CHANNEL_ID=123456789012345678
```

### 4. Buat file `.gitignore`

```bash
touch .gitignore
```

Isi `.gitignore`:

```
.env
node_modules/
```

> ⚠️ **PENTING:** Jangan pernah commit file `.env` ke Git/GitHub karena berisi private key!


## 🚀 Cara Menjalankan

### Mode default (read-only, aman)

Secara default script hanya menjalankan fungsi baca saja (tidak ada transaksi):

```bash
node kiichain-staking.js
```

Output yang akan muncul:
```
🚀 KiiChain Staking + Faucet Script
   Network  : kiichain3 (Testnet Oro)
   RPC      : https://rpc.uno.sentry.testnet.v3.kiivalidator.com
   Faucet   : https://explorer.kiichain.io/faucet

   Wallet   : kii1abc123...

══════════════════════════════════════════════════════════
  💰 Saldo Wallet
══════════════════════════════════════════════════════════
  Address  : kii1abc123...
  Saldo    : 2500.000000 KII (2500000000 ukii)

══════════════════════════════════════════════════════════
  🏛️  Daftar Validator Aktif
══════════════════════════════════════════════════════════
  [1] KiiValidator
       Address    : kiivaloper1...
       Total Stake: 1000000.000000 KII
       Commission : 5.00%
       Status     : BOND_STATUS_BONDED
...
```

### Mengaktifkan fitur transaksi

Edit bagian `main()` di bawah script, lalu **uncomment** fungsi yang ingin dijalankan:

```js
// Klaim faucet via website
await claimFaucetWeb(address);

// Klaim faucet via Discord
await claimFaucetDiscord(address);

// Delegate 1 KII
await delegate(1);

// Undelegate 0.5 KII
await undelegate(0.5);

// Redelegate ke validator lain
const src = "kiivaloper1aaa...";
const dst = "kiivaloper1bbb...";
await redelegate(0.5, src, dst);

// Klaim semua reward
await claimRewards();
```

---

## 💡 Penjelasan Setiap Fitur

### 1. Cek Saldo (`checkBalance`)

Menampilkan saldo token KII pada wallet yang dikonfigurasi.

```js
await checkBalance(address);
```

---

### 2. Daftar Validator (`getValidators`)

Mengambil hingga 20 validator aktif berikut informasi komisi dan total stake.

```js
await getValidators();
```

---

### 3. Lihat Delegasi (`getDelegations`)

Menampilkan semua validator tempat wallet sedang mendelegasikan token beserta jumlahnya.

```js
await getDelegations(address);
```

---

### 4. Lihat Reward (`getRewards`)

Menampilkan reward staking yang belum diklaim dari setiap validator.

```js
await getRewards(address);
```

---

### 5. Delegate / Stake (`delegate`)

Mendelegasikan sejumlah token KII ke validator yang dikonfigurasi di `CONFIG.validatorAddress`.

```js
await delegate(1);      // Delegate 1 KII
await delegate(100);    // Delegate 100 KII
```

> ✅ Token langsung mulai menghasilkan reward setelah transaksi dikonfirmasi.

---

### 6. Undelegate / Unstake (`undelegate`)

Menarik kembali token yang sudah didelegasikan.

```js
await undelegate(0.5);  // Undelegate 0.5 KII
```

> ⚠️ Token akan memasuki **masa unbonding selama ±21 hari** sebelum bisa digunakan kembali.

---

### 7. Redelegate (`redelegate`)

Memindahkan delegasi dari satu validator ke validator lain **tanpa masa unbonding**.

```js
const src = "kiivaloper1validator_lama...";
const dst = "kiivaloper1validator_baru...";
await redelegate(0.5, src, dst);
```

> ✅ Tidak ada masa tunggu — token langsung aktif di validator baru.

---

### 8. Klaim Reward (`claimRewards`)

Mengklaim semua reward staking dari seluruh validator dalam satu transaksi.

```js
await claimRewards();
```

---

### 9. Klaim Faucet via Website (`claimFaucetWeb`)

Mengirimkan HTTP POST request ke endpoint faucet KiiChain Explorer secara otomatis.

```js
await claimFaucetWeb(address);
```

| Info | Detail |
|------|--------|
| URL | https://explorer.kiichain.io/faucet |
| Jumlah | 2.500 KII per request |
| Limit | 1x per 24 jam per address |

Jika sudah diklaim dalam 24 jam, server akan merespons dengan HTTP 429 dan script menampilkan pesan informatif.

---

### 10. Klaim Faucet via Discord (`claimFaucetDiscord`)

Bot Discord login ke server KiiChain lalu mengirim pesan ke channel `#faucet`:

```
$request kii1abc123def456...
```

```js
await claimFaucetDiscord(address);
```

| Info | Detail |
|------|--------|
| Format pesan | `$request <wallet_address>` |
| Jumlah | 2.500 KII per request |
| Limit | 1x per 24 jam per address |
| Channel | `#faucet` server Discord KiiChain |

---

## 🤖 Setup Discord Bot (Untuk Fitur Faucet Discord)

### Langkah 1 — Buat Discord Bot

1. Buka https://discord.com/developers/applications
2. Klik **New Application** → beri nama (contoh: `KiiChain Faucet Bot`)
3. Klik menu **Bot** di sidebar kiri
4. Klik **Reset Token** → konfirmasi → **copy token**
5. Simpan token ke `.env`:
   ```env
   DISCORD_BOT_TOKEN=your_token_here
   ```

### Langkah 2 — Atur Permission Bot

Masih di halaman Bot:
- Aktifkan **Message Content Intent** (di bagian Privileged Gateway Intents)

### Langkah 3 — Undang Bot ke Server KiiChain

1. Klik menu **OAuth2** → **URL Generator**
2. Centang scope: `bot`
3. Centang permission: `Send Messages`
4. Copy URL yang dihasilkan → buka di browser → pilih server KiiChain → klik **Authorize**

### Langkah 4 — Dapatkan Channel ID

1. Buka Discord → **User Settings** → **Advanced**
2. Aktifkan **Developer Mode**
3. Kembali ke server KiiChain → klik kanan channel `#faucet`
4. Klik **Copy Channel ID**
5. Simpan ke `.env`:
   ```env
   DISCORD_FAUCET_CHANNEL_ID=123456789012345678
   ```

---

## 🔐 Keamanan Private Key

### Format yang diterima

| Format | Contoh | Status |
|--------|--------|--------|
| Dengan prefix `0x` | `0xabc123def456...` | ✅ |
| Tanpa prefix | `abc123def456...` | ✅ |
| Panjang wajib | 64 karakter hex (32 bytes) | ✅ |

### Cara mendapatkan private key

**MetaMask:**
1. Klik ikon akun → titik tiga → **Account Details**
2. Klik **Show private key** → masukkan password → copy

**Keplr:**
1. Klik ikon Keplr → menu hamburger → **Export Private Key**
2. Masukkan password → copy

> ⚠️ **Peringatan Keamanan:**
> - Jangan pernah share private key ke siapapun
> - Jangan hardcode di dalam script
> - Selalu gunakan file `.env` yang masuk `.gitignore`
> - Untuk produksi, gunakan secret manager (AWS Secrets Manager, HashiCorp Vault, dll)

---

## 🌐 Endpoint Jaringan

| Endpoint | URL |
|----------|-----|
| RPC (Cosmos) | `https://rpc.uno.sentry.testnet.v3.kiivalidator.com` |
| LCD / REST | `https://lcd.uno.sentry.testnet.v3.kiivalidator.com` |
| JSON-RPC (EVM) | `https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com` |
| Explorer | https://explorer.kiichain.io |
| Faucet | https://explorer.kiichain.io/faucet |

---

## ❓ Troubleshooting

### ❌ `Private key tidak ditemukan`
**Solusi:** Pastikan file `.env` ada dan berisi `KIICHAIN_PRIVATE_KEY=0x...`

```bash
cat .env   # cek isi file
```

---

### ❌ `Private key harus 64 karakter hex`
**Solusi:** Private key yang dimasukkan tidak lengkap atau salah format. Pastikan panjangnya tepat 64 karakter (tanpa prefix `0x`).

---

### ❌ `Gagal login bot Discord`
**Solusi:**
- Pastikan `DISCORD_BOT_TOKEN` benar dan belum expired
- Reset token baru di https://discord.com/developers/applications jika perlu

---

### ❌ `Channel ID tidak ditemukan`
**Solusi:**
- Pastikan Developer Mode aktif di Discord
- Pastikan bot sudah bergabung ke server KiiChain
- Pastikan Channel ID yang dicopy benar (18 digit angka)

---

### ❌ `insufficient funds`
**Solusi:** Saldo wallet tidak cukup untuk membayar gas. Klaim token testnet via faucet terlebih dahulu:
```js
await claimFaucetWeb(address);
// atau
await claimFaucetDiscord(address);
```

---

### ❌ `account sequence mismatch`
**Solusi:** Ada transaksi sebelumnya yang masih pending. Tunggu beberapa detik lalu coba lagi.

---

## 📁 Struktur Proyek

```
kiichain-staking/
├── kiichain-staking.js   ← Script utama
├── .env                  ← Konfigurasi rahasia (jangan di-commit!)
├── .gitignore            ← Berisi .env dan node_modules
├── package.json          ← Dependencies
├── node_modules/         ← Hasil npm install
└── README.md             ← Dokumentasi ini
```

---

## 🔗 Link Penting

| Resource | URL |
|----------|-----|
| KiiChain Explorer | https://explorer.kiichain.io |
| Faucet Website | https://explorer.kiichain.io/faucet |
| Discord KiiChain | https://discord.gg/kiichain |
| Dokumentasi KiiChain | https://docs.kiiglobal.io |
| GitHub KiiChain | https://github.com/KiiChain |
| Discord Developer Portal | https://discord.com/developers/applications |

---

## 📜 Lisensi

Script ini dibuat untuk keperluan edukasi dan pengujian di jaringan testnet KiiChain. Gunakan dengan bijak dan bertanggung jawab.
