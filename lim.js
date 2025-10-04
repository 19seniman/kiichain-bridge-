const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

// --- 1. KONFIGURASI JARINGAN EVM (Kii Testnet Oro) ---
const EVM_CONFIG = {
    RPC_URL: 'https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/',
    CHAIN_ID: 1336,
    BRIDGE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000001002', 
    // Data input tambahan yang mungkin diperlukan, jika ada.
    // Kita akan menyertakan alamat tujuan Cosmos di sini, karena fungsi EVM tidak mengambilnya sebagai parameter.
    // Format data ini HARUS SESUAI dengan yang diharapkan oleh Kii Chain Bridge.
    // Contoh format data: alamat Cosmos (di-encode sebagai string)
    // Karena format encode IBC ke EVM sangat bervariasi, kita biarkan data kosong dulu.
    COSMOS_RECIPIENT_DATA: '0x' 
};

// --- 2. KONFIGURASI TRANSAKSI BRIDGE ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, 
    AMOUNT_TO_SEND_EVM: '0.1', 
    COSMOS_CONFIG_FILE: 'cosmos.json'
};

/**
 * Fungsi untuk memuat alamat tujuan dari file JSON.
 * (Tidak ada perubahan di sini)
 */
function loadCosmosRecipient() {
    try {
        const data = fs.readFileSync(GLOBAL_CONFIG.COSMOS_CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);
        const recipient = config.recipientAddress;
        
        if (!recipient || recipient.startsWith('kii1...') || recipient === '') {
            throw new Error("Alamat tujuan di cosmos.json tidak valid atau belum diganti.");
        }
        return recipient;
    } catch (error) {
        console.error(`🚨 GAGAL membaca file ${GLOBAL_CONFIG.COSMOS_CONFIG_FILE}: ${error.message}`);
        process.exit(1); 
    }
}

/**
 * Fungsi utama untuk menjembatani token dari EVM ke Cosmos.
 */
async function bridgeEVMToCosmos() {
    const cosmosRecipientAddress = loadCosmosRecipient();

    if (!GLOBAL_CONFIG.PRIVATE_KEY) {
        console.error("🚨 Kunci pribadi (PRIVATE_KEY) tidak ditemukan di .env. Harap periksa!");
        return;
    }

    try {
        const provider = new ethers.JsonRpcProvider(EVM_CONFIG.RPC_URL, EVM_CONFIG.CHAIN_ID);
        const wallet = new ethers.Wallet(GLOBAL_CONFIG.PRIVATE_KEY, provider);
        
        const senderAddress = await wallet.getAddress();
        const amountWei = ethers.parseUnits(GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM, 'ether');
        
        console.log(`✅ Terhubung ke EVM. Pengirim: ${senderAddress}`);
        console.log(`DESTINASI COSMOS: ${cosmosRecipientAddress}`);
        console.log(`⏳ Mencoba bridge ${GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM} KII (${amountWei.toString()} wei) melalui transaksi EVM dasar...`);

        // --- Perubahan Kunci: Mengirim Transaksi EVM Dasar ---
        // Alamat tujuan Cosmos di-encode ke dalam data transaksi, yang formatnya HARUS SPESIFIK.
        // Paling aman: Mengasumsikan data adalah string alamat Cosmos yang di-encode sebagai UTF-8.
        
        const dataPayload = ethers.toUtf8Bytes(cosmosRecipientAddress); // Mengasumsikan payload adalah alamat Cosmos
        
        const tx = await wallet.sendTransaction({
            to: EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS,
            value: amountWei, 
            data: dataPayload, // Mengirim alamat Cosmos sebagai data input
            gasLimit: 500000 
        });

        console.log(`⏳ Transaksi EVM terkirim. Hash: ${tx.hash}`);
        
        // Tunggu hingga transaksi dikonfirmasi
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log("🎉 Bridge Berhasil dikonfirmasi di EVM!");
            console.log(`🔗 Token KII Anda sedang diproses oleh Relayer. Tx Hash: ${receipt.hash}`);
        } else {
            console.error("❌ Transaksi gagal dikonfirmasi di EVM. Status: 0 (Reverted)");
            console.log("Ini mungkin berarti format 'data' (alamat Cosmos) salah atau kontrak tetap tidak memproses.");
        }

    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis saat bridging:', error.message);
        console.log("\n⚠️ Pastikan: 1. Alamat Cosmos Anda benar. 2. Saldo KII Anda cukup.");
    }
}

// Jalankan fungsi
bridgeEVMToCosmos();
