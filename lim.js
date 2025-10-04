const { SigningStargateClient, StdFee } = require('@cosmjs/stargate');
const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');
const fs = require('fs');
const readline = require('readline-sync');
require('dotenv').config();

// --- 1. KONFIGURASI GLOBAL ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, // Mnemonic (atau kunci pribadi hex)
    CONFIG_FILE: 'cosmos.json',
};

// --- 2. FUNGSI MEMUAT KONFIGURASI ---
function loadCosmosConfig() {
    try {
        const data = fs.readFileSync(GLOBAL_CONFIG.CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);
        
        // Cek semua nilai penting
        if (!config.recipientAddress || !config.sourceRpc || !config.sourceChainId || !config.ibcChannelId) {
            throw new Error("Satu atau lebih konfigurasi di cosmos.json tidak lengkap atau salah.");
        }
        return config;
    } catch (error) {
        console.error(`🚨 GAGAL memuat konfigurasi: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Fungsi utama untuk melakukan transfer IBC
 */
async function runIbcTransferBot(amountToken, totalIterations) {
    const config = loadCosmosConfig();
    if (!GLOBAL_CONFIG.PRIVATE_KEY) {
        console.error("🚨 Kunci pribadi (PRIVATE_KEY) tidak ditemukan di .env. Harap periksa!");
        return;
    }

    // Inisialisasi Wallet
    const wallet = await DirectSecp256k1Wallet.fromMnemonic(GLOBAL_CONFIG.PRIVATE_KEY, { prefix: 'kii' }); // Ganti prefix jika perlu
    const [firstAccount] = await wallet.getAccounts();
    const senderAddress = firstAccount.address;

    try {
        // Koneksi ke Source Chain
        const client = await SigningStargateClient.connectWithSigner(config.sourceRpc, wallet);
        
        const amountWei = BigInt(Math.floor(amountToken * 10**6)); // Asumsi 6 desimal (umum di Cosmos)
        const amountToTransfer = [{ denom: config.sourceDenom, amount: amountWei.toString() }];
        
        console.log(`\n======================================================`);
        console.log(`✅ BOT IBC DIMULAI: ${totalIterations}x Transfer @ ${amountToken} ${config.sourceDenom}`);
        console.log(`Pengirim: ${senderAddress}`);
        console.log(`Tujuan: ${config.destinationChainId} melalui ${config.ibcChannelId}`);
        console.log(`======================================================`);

        for (let i = 1; i <= totalIterations; i++) {
            const timeoutInSeconds = 60 * 10; // 10 menit
            const timeoutTimestamp = Math.floor(Date.now() / 1000) + timeoutInSeconds;
            
            // Biaya Transaksi (Asumsi biaya minimum)
            const fee = {
                amount: [{ denom: config.feeDenom, amount: '5000' }], // Ganti dengan biaya yang sesuai
                gas: '250000',
            };

            console.log(`\n---> Mulai Transaksi IBC #${i} dari ${totalIterations}...`);

            try {
                // Melakukan transfer IBC native (IBC ICS-20)
                const tx = await client.sendIbcTokens(
                    senderAddress,
                    config.recipientAddress,
                    amountToTransfer,
                    config.sourceDenom,
                    config.ibcChannelId,
                    timeoutTimestamp, // Timestamp dalam detik
                    fee,
                    `Auto IBC Transfer #${i}`
                );

                if (tx.code === 0) {
                    console.log(`🎉 Transaksi #${i}: BERHASIL! Tx Hash: ${tx.hash}`);
                } else {
                    console.error(`❌ Transaksi #${i}: GAGAL ON-CHAIN. Code: ${tx.code}. Log: ${tx.rawLog}`);
                    // Tetap lanjutkan ke iterasi berikutnya
                }

            } catch (error) {
                // Menangkap eror sebelum transaksi masuk blok (misal: saldo kurang, node mati)
                console.error(`❌ Transaksi #${i}: GAGAL KRITIS. Error: ${error.message}`);
                // Memberi jeda kecil agar tidak membanjiri node RPC
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        console.log("\n======================================================");
        console.log("✅ Semua iterasi transaksi selesai.");
        console.log("======================================================");

    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis Saat Koneksi/Inisialisasi:', error.message);
    }
}

// --- MENU UTAMA ---
function startBotMenu() {
    console.log("--- Bot Transfer IBC Cosmos Native ---");
    const amount = readline.questionFloat("Masukkan jumlah token (misal: 1.5) per transaksi: ");
    const times = readline.questionInt("Masukkan berapa kali transaksi diulang: ");

    if (amount <= 0 || times <= 0) {
        console.error("Jumlah token dan ulangan harus lebih besar dari nol.");
        return;
    }

    runIbcTransferBot(amount, times);
}

startBotMenu();
