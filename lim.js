const { ethers } = require('ethers');
const fs = require('fs'); // Modul untuk membaca file
require('dotenv').config();

// --- 1. KONFIGURASI JARINGAN EVM (Kii Testnet Oro) ---
const EVM_CONFIG = {
    RPC_URL: 'https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/',
    CHAIN_ID: 1336,
    BRIDGE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000001002', 
};

// --- 2. KONFIGURASI TRANSAKSI BRIDGE ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, 
    AMOUNT_TO_SEND_EVM: '0.1', // Jumlah KII yang ingin dikirim
    COSMOS_CONFIG_FILE: 'cosmos.json' // Nama file konfigurasi baru
};

// --- 3. ABI TENTATIF TERBAIK (Model Bridge Token Natif/Ether) ---
const BRIDGE_ABI = [
    // Asumsi Fungsi Bridge Terbaik: Menerima String Alamat Cosmos
    "function sendToCosmos(string recipient)", 
    "function transfer(address recipient, uint256 amount) returns (bool)", 
];

/**
 * Fungsi untuk memuat alamat tujuan dari file JSON.
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
        process.exit(1); // Hentikan eksekusi jika gagal membaca atau alamat tidak valid
    }
}


/**
 * Fungsi utama untuk menjembatani token dari EVM ke Cosmos.
 */
async function bridgeEVMToCosmos() {
    // Memuat alamat tujuan dari file
    const cosmosRecipientAddress = loadCosmosRecipient();

    if (!GLOBAL_CONFIG.PRIVATE_KEY) {
        console.error("🚨 Kunci pribadi (PRIVATE_KEY) tidak ditemukan di .env. Harap periksa!");
        return;
    }

    try {
        // 1. Inisialisasi Provider dan Signer
        const provider = new ethers.JsonRpcProvider(EVM_CONFIG.RPC_URL, EVM_CONFIG.CHAIN_ID);
        const wallet = new ethers.Wallet(GLOBAL_CONFIG.PRIVATE_KEY, provider);
        const bridgeContract = new ethers.Contract(EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS, BRIDGE_ABI, wallet);
        
        const senderAddress = await wallet.getAddress();
        
        // 2. Konversi Jumlah ke Satuan EVM (Wei)
        const amountWei = ethers.parseUnits(GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM, 'ether');
        console.log(`✅ Terhubung ke EVM. Pengirim: ${senderAddress}`);
        console.log(`DESTINASI: ${cosmosRecipientAddress}`);
        console.log(`⏳ Mencoba bridge ${GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM} KII (${amountWei.toString()} wei)...`);

        // 3. Panggil Fungsi Smart Contract Bridge (Menggunakan Asumsi 'sendToCosmos')
        const tx = await bridgeContract.sendToCosmos(
            cosmosRecipientAddress,
            { 
                value: amountWei, 
                gasLimit: 500000 
            } 
        );

        console.log(`⏳ Transaksi EVM terkirim. Hash: ${tx.hash}`);
        
        // Tunggu hingga transaksi dikonfirmasi
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log("🎉 Bridge Berhasil dikonfirmasi di EVM!");
            console.log(`🔗 Token KII Anda sekarang diproses oleh Relayer. Tx Hash: ${receipt.hash}`);
        } else {
            console.error("❌ Transaksi gagal dikonfirmasi di EVM. Status: 0");
        }

    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis saat bridging:', error.message);
        console.log("\n⚠️ Pastikan: 1. ABI/Nama Fungsi benar. 2. Saldo KII mencukupi.");
    }
}

// Jalankan fungsi
bridgeEVMToCosmos();
