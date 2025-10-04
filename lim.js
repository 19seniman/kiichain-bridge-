const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline-sync'); // Modul baru untuk input
require('dotenv').config();

// --- 1. KONFIGURASI JARINGAN EVM (Kii Testnet Oro) ---
const EVM_CONFIG = {
    RPC_URL: 'https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/',
    CHAIN_ID: 1336,
    BRIDGE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000001002', 
    IBC_CHANNEL_ID: 'channel-1', 
};

// --- 2. KONFIGURASI GLOBAL ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, 
    COSMOS_CONFIG_FILE: 'cosmos.json',
};

// --- 3. ABI IBC EVM MINIMALIS (Asumsi Gagal) ---
const IBC_ABI_MINIMAL = [
    "function transfer(string recipient, string channelId, uint64 timeoutTimestamp)"
];

/**
 * Fungsi untuk memuat alamat tujuan dari file JSON.
 */
function loadCosmosRecipient() {
    try {
        const data = fs.readFileSync(GLOBAL_CONFIG.COSMOS_CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);
        const recipient = config.recipientAddress;
        
        if (!recipient || recipient.startsWith('kii1...')) {
            throw new Error("Alamat tujuan di cosmos.json belum valid.");
        }
        return recipient;
    } catch (error) {
        console.error(`🚨 GAGAL memuat konfigurasi: ${error.message}`);
        process.exit(1); 
    }
}

// ---
async function bridgeEVMToCosmos(amountToken, totalIterations) {
    const cosmosRecipientAddress = loadCosmosRecipient();
    if (!GLOBAL_CONFIG.PRIVATE_KEY) return;

    try {
        const provider = new ethers.JsonRpcProvider(EVM_CONFIG.RPC_URL, EVM_CONFIG.CHAIN_ID);
        const wallet = new ethers.Wallet(GLOBAL_CONFIG.PRIVATE_KEY, provider);
        const ibcContract = new ethers.Contract(EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS, IBC_ABI_MINIMAL, wallet);
        
        const senderAddress = await wallet.getAddress();
        const amountWei = ethers.parseUnits(String(amountToken), 'ether');
        
        console.log(`\n======================================================`);
        console.log(`✅ BOT DIMULAI: ${totalIterations}x Transfer @ ${amountToken} KII`);
        console.log(`Pengirim: ${senderAddress}`);
        console.log(`Kontrak: ${EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS}`);
        console.log(`======================================================`);

        for (let i = 1; i <= totalIterations; i++) {
            const timeoutInSeconds = 60 * 10;
            const timeoutTimestamp = BigInt(Math.floor(Date.now() / 1000) + timeoutInSeconds);
            
            console.log(`\n---> Mulai Transaksi #${i} dari ${totalIterations}...`);

            try {
                // PANGGILAN KONTRAK YANG SANGAT MUNGKIN GAGAL
                const tx = await ibcContract.transfer(
                    cosmosRecipientAddress,
                    EVM_CONFIG.IBC_CHANNEL_ID,
                    timeoutTimestamp,
                    { 
                        value: amountWei, 
                        gasLimit: 500000 
                    } 
                );

                console.log(`⏳ Transaksi terkirim. Hash: ${tx.hash}`);
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                    console.log(`🎉 Transaksi #${i}: BERHASIL! Tx Hash: ${receipt.hash}`);
                } else {
                    // Jika dikirim tapi status = 0 (revert)
                    console.error(`❌ Transaksi #${i}: GAGAL REVERT (Status 0). Gas habis!`);
                    // Bot tetap melanjutkan ke iterasi berikutnya
                }

            } catch (error) {
                // Menangkap eror sebelum transaksi masuk blok (misal: RPC down, gas estimation error)
                if (error.code === 'CALL_EXCEPTION') {
                    console.error(`❌ Transaksi #${i}: GAGAL KRITIS (REVERT). Lanjut ke iterasi berikutnya.`);
                    // Bot mengabaikan eror CALL_EXCEPTION dan melanjutkan
                } else {
                    console.error(`❌ Transaksi #${i}: GAGAL (Kode: ${error.code}). Coba lagi.`, error.message);
                    // Bot tetap melanjutkan ke iterasi berikutnya
                }
            }
        }
        console.log("\n======================================================");
        console.log("✅ Semua iterasi transaksi selesai.");
        console.log("======================================================");


    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis Saat Inisialisasi Bot:', error.message);
    }
}

// --- MENU UTAMA ---
function startBotMenu() {
    console.log("--- Bot Bridge Kii Chain IBC ---");
    const amount = readline.questionFloat("Masukkan jumlah token KII per transaksi: ");
    const times = readline.questionInt("Masukkan berapa kali transaksi diulang: ");

    if (amount <= 0 || times <= 0) {
        console.error("Jumlah token dan ulangan harus lebih besar dari nol.");
        return;
    }

    bridgeEVMToCosmos(amount, times);
}

startBotMenu();
