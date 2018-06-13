var LitClient = require('../../lit-rpc-client-nodejs').LitClient;
var LitRPC = require('../../lit-rpc-client-nodejs').LitRPC;
const readline = require('readline')

// The variables for the contract
const oraclePubKey = Buffer.from('03c0d496ef6656fe102a689abc162ceeae166832d826f8750c94d797c92eedd465','hex');
const rPoint = Buffer.from('027168bba1aaecce0500509df2ff5e35a4f55a26a8af7ceacd346045eceb1786ad','hex');
const oracleValue = 15161;
const oracleSig = Buffer.from('9e349c50db6d07d5d8b12b7ada7f91d13af742653ff57ffb0b554170536faeac','hex');

// Construct LIT nodes
var lit1 = new LitClient("localhost", 8001);
var lit2 = new LitClient("localhost", 8002);

// Connect the two nodes together
async function connectNodes() {
    // Connect to both LIT nodes
    await lit1.open();
    await lit2.open();

    // Instruct both nodes to listen for incoming connections
    await lit1.listen();
    await lit2.listen();

    // Connect node 1 to node 2
    lnadr = await lit2.getLNAddress();
    lit1.connect(lnadr,"localhost:2449");
}

// Ensure the oracle we need is present on both nodes
// and return its id
async function checkOracle()  {
    // Fetch a list of oracles from both nodes
    let oracles1 = await lit1.listOracles();
    let oracles2 = await lit2.listOracles();

    // Find the oracle we need in both lists
    var oracle1 = oracles1.find(o => Buffer.from(o.A).equals(oraclePubKey))
    var oracle2 = oracles2.find(o => Buffer.from(o.A).equals(oraclePubKey))
    
    // If the oracle is not present on node 1, add it
    if(oracle1 === undefined) {
        oracle1 = await lit1.addOracle(oraclePubKey.toString('hex'),"Tutorial")
    }

    // If the oracle is not present on node 2, add it
    if(oracle2 === undefined) {
        oracle2 = await lit2.addOracle(oraclePubKey.toString('hex'),"Tutorial")
    }

    // Return the index the oracle has on both nodes
    return [oracle1.Idx, oracle2.Idx]
}

async function createContract(oracleIdx) {
    // Create a new empty draft contract
    let contract = await lit1.newContract();

    // Configure the contract to use the oracle we need
    await lit1.setContractOracle(contract.Idx, oracleIdx)

    // Set the settlement time to June 13, 2018 midnight UTC
    await lit1.setContractSettlementTime(contract.Idx, 1528848000)
    
    // Set the coin type of the contract to Bitcoin Regtest
    await lit1.setContractCoinType(contract.Idx, 257);

    // Configure the contract to use the R-point we need
    await lit1.setContractRPoint(contract.Idx, [...rPoint])

    // Set the contract funding to 1 BTC each
    await lit1.setContractFunding(contract.Idx, 100000000, 100000000);

    // Configure the contract division so that we get all the
    // funds when the value is 20000, and our counter party gets
    // all the funds when the value is 10000
    await lit1.setContractDivision(contract.Idx, 20000, 10000);

    return contract;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acceptContract() {
    // Get all contracts for node 2
    let contracts = await lit2.listContracts()
    
    // Find the first contract that's not accepted and accept it.
    for(contract of contracts) {
        if(contract.Status === LitRPC.DlcContractStatus.ContractStatusOfferedToMe) {
            await lit2.acceptContract(contract.Idx);
            return
        }
    }
}

async function isContractActive(contractIdx) {
    // Fetch the contract from node 1
    let contract = await lit1.getContract(contractIdx)

    // Return if the contract is active
    return (contract.Status === LitRPC.DlcContractStatus.ContractStatusActive);
}

async function main() {
    try {
        // Connect both LIT peers together
        console.log("Connecting nodes together...")
        await connectNodes();

        // Find out if the oracle is present and add it if not
        console.log("Ensuring oracle is available...")
        var oracleIdxs = await checkOracle();

        // Create the contract and set its parameters
        console.log("Creating the contract...")
        var contract = await createContract(oracleIdxs[0]);
                
        // Offer the contract to the other peer
        console.log("Offering the contract to the other peer...")
        await lit1.offerContract(contract.Idx, 1);

        // Wait for the contract to be exchanged
        console.log("Waiting for the contract to be exchanged...")
        await sleep(2000);

        // Accept the contract on the second node
        console.log("Accepting the contract on the other peer...")
        await acceptContract();


        // Wait for the contract to be activated
        console.log("Waiting for the contract to be activated...")
        while(!await isContractActive(contract.Idx)) 
            await sleep(1000);

        // Ask the user to mine a block and press return
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        await new Promise(function (resolve, reject) {
            rl.question('Contract active. Generate a block on regtest and press enter', (answer) => {
                resolve();
            });
        });
       
        // Settle the contract
        console.log("Settling the contract...")
        await lit1.settleContract(contract.Idx, oracleValue, [...oracleSig]);

        console.log("Contract settled. Mine two blocks to ensure contract outputs are claimed back to the nodes' wallets.\r\n\r\nDone.")

    } catch (e) {
        console.log(e);
    }
    return Promise.resolve()
}

main();
