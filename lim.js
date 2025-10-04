const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

// --- 1. KONFIGURASI JARINGAN EVM (Kii Testnet Oro) ---
const EVM_CONFIG = {
    RPC_URL: 'https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/',
    CHAIN_ID: 1336,
    BRIDGE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000001002', 
    IBC_CHANNEL_ID: 'channel-1', 
};

// --- 2. KONFIGURASI TRANSAKSI BRIDGE ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, 
    AMOUNT_TO_SEND_EVM: '0.1', 
    COSMOS_CONFIG_FILE: 'cosmos.json',
};

// --- 3. ABI IBC EVM MINIMALIS (PERCOBAAN TERAKHIR) ---
const IBC_ABI_MINIMAL = [
    // Asumsi: Kontrak membaca port 'transfer' secara internal dan denom 'KII' sebagai value
    "function transfer(string recipient, string channelId, uint64 timeoutTimestamp)"
];

/**
 * Fungsi untuk memuat alamat tujuan dari file JSON. (Sama seperti sebelumnya)
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
async function bridgeEVMToCosmos() {
    const cosmosRecipientAddress = loadCosmosRecipient();
    if (!GLOBAL_CONFIG.PRIVATE_KEY) return;

    try {
        const provider = new ethers.JsonRpcProvider(EVM_CONFIG.RPC_URL, EVM_CONFIG.CHAIN_ID);
        const wallet = new ethers.Wallet(GLOBAL_CONFIG.PRIVATE_KEY, provider);
        const ibcContract = new ethers.Contract(EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS, IBC_ABI_MINIMAL, wallet);
        
        const senderAddress = await wallet.getAddress();
        const amountWei = ethers.parseUnits(GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM, 'ether');
        
        const timeoutInSeconds = 60 * 10; // 10 menit
        const timeoutTimestamp = BigInt(Math.floor(Date.now() / 1000) + timeoutInSeconds); // Dalam detik (uint64)

        console.log(`✅ Terhubung. Pengirim: ${senderAddress}`);
        console.log(`⏳ Mencoba IBC Transfer Minimalis ke ${EVM_CONFIG.IBC_CHANNEL_ID}...`);

        // --- Panggilan Fungsi IBC Kontrak dengan Parameter Minimalis ---
        const tx = await ibcContract.transfer(
            cosmosRecipientAddress,
            EVM_CONFIG.IBC_CHANNEL_ID,
            timeoutTimestamp,
            { 
                value: amountWei, // Mengirim KII natif sebagai value
                gasLimit: 500000 
            } 
        );

        console.log(`⏳ Transaksi IBC terkirim. Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log("🎉 IBC Transfer Berhasil dikonfirmasi di EVM!");
            console.log(`🔗 Cek status transfer di explorer. Tx Hash: ${receipt.hash}`);
        } else {
            console.error("❌ Transaksi gagal dikonfirmasi di EVM. Status: 0 (Reverted)");
            console.log("Ini berarti ABI/Fungsi Minimalis juga salah.");
        }

    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis:', error.message);
    }
}

// Jalankan fungsi
bridgeEVMToCosmos();
