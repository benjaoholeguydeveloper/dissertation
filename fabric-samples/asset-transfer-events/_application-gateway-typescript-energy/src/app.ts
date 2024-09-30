/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as grpc from '@grpc/grpc-js';
import { ChaincodeEvent, CloseableAsyncIterable, connect, Contract, GatewayError, Network } from '@hyperledger/fabric-gateway';
import { TextDecoder } from 'util';
import { newGrpcConnection, newIdentity, newSigner } from './connect';

const channelName = 'mychannel';
const chaincodeName = 'energy';

const utf8Decoder = new TextDecoder();
const assetId = 'Apartment0';
const arrayArg = JSON.stringify(['9261', '9261']);


async function main(): Promise<void> {
    const client = await newGrpcConnection();
    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        evaluateOptions: () => {
            return { deadline: Date.now() + 5000 }; // 5 seconds
        },
        endorseOptions: () => {
            return { deadline: Date.now() + 15000 }; // 15 seconds
        },
        submitOptions: () => {
            return { deadline: Date.now() + 5000 }; // 5 seconds
        },
        commitStatusOptions: () => {
            return { deadline: Date.now() + 60000 }; // 1 minute
        },
    });

    let events: CloseableAsyncIterable<ChaincodeEvent> | undefined;

    try {
        const network = gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);

        // Listen for events emitted by subsequent transactions
        events = await startEventListening(network);

        const firstBlockNumber = await createAsset(contract);
        await updateAsset(contract);
        // await deleteAssetByID(contract);

        // Replay events from the block containing the first transaction
        await replayChaincodeEvents(network,contract,firstBlockNumber);
    } finally {
        events?.close();
        gateway.close();
        client.close();
    }
}

main().catch((error: unknown) => {
    console.error('******** FAILED to run the application:', error);
    process.exitCode = 1;
});

async function startEventListening(network: Network): Promise<CloseableAsyncIterable<ChaincodeEvent>> {
    console.log('\n*** Start chaincode event listening');

    const events = await network.getChaincodeEvents(chaincodeName);

    void readEvents(events); // Don't await - run asynchronously
    return events;
}

async function readEvents(events: CloseableAsyncIterable<ChaincodeEvent>): Promise<void> {
    try {
        for await (const event of events) {
            const payload = parseJson(event.payload);
            console.log(`\n<-- Chaincode event received: ${event.eventName} -`, payload);
        }
    } catch (error: unknown) {
        // Ignore the read error when events.close() is called explicitly
        if (!(error instanceof GatewayError) || error.code !== grpc.status.CANCELLED.valueOf()) {
            throw error;
        }
    }
}

function parseJson(jsonBytes: Uint8Array): unknown {
    const json = utf8Decoder.decode(jsonBytes);
    return JSON.parse(json);
}

async function createAsset(contract: Contract): Promise<bigint> {
    console.log(`\n--> Submit Transaction: CreateAsset, ${assetId} with energy usage 0`);

    const result = await contract.submitAsync('CreateAsset', {
        arguments: [ assetId ],
    });

    const status = await result.getStatus();
    if (!status.successful) {
        throw new Error(`failed to commit transaction ${status.transactionId} with status code ${String(status.code)}`);
    }

    console.log('\n*** CreateAsset committed successfully');

    for (let i = 0; i < 10000; i++) {
        const apartmentID = `Apartment${i + 1}`;
        console.log(`\n--> Submit Transaction: CreateAsset, ${apartmentID} with energy usage 0`);

        const result = await contract.submitAsync('CreateAsset', {
            arguments: [ apartmentID ],
        });
    
        const status = await result.getStatus();
        if (!status.successful) {
            throw new Error(`failed to commit transaction ${status.transactionId} with status code ${String(status.code)}`);
        }
    
        console.log('\n*** CreateAsset committed successfully');
    }

    return status.blockNumber;
}

async function updateAsset(contract: Contract): Promise<void> {
    let totalTime = 0;
    let totalNodes = 0;
    let assetLowerID = '';
    let assetHigherID = '';
    let assetLowerEnergyUsage = 1000;
    let assetHigherEnergyUsage = 0;
    let allLatencyArray = [];

    for (let i = 0; i < 10000; i++) {
        totalNodes++;
        const apartmentID = `Apartment${i + 1}`;
        console.log(`\n--> Submit transaction: UpdateAsset, ${apartmentID} total nodes ${totalNodes}`);
        const asset = await contract.submitTransaction('GetEnergyUsage', apartmentID, arrayArg);
        const response = JSON.parse(utf8Decoder.decode(asset));
        if (response.Latency < assetLowerEnergyUsage) {
            assetLowerEnergyUsage = response.Latency;
            assetLowerID = `Apartment${i + 1}`;
        }

        if (response.Latency > assetHigherEnergyUsage) {
            assetHigherEnergyUsage = response.Latency;
            assetHigherID = `Apartment${i + 1}`;
        }
        
        console.log(`\n*** UpdateAsset committed successfully ********* 
            ${JSON.stringify(response)} *****
            ${JSON.stringify(new Date(response.StartTime))}**********
            ${JSON.stringify(new Date(response.EndTime))}*****`
        );
        await contract.submitTransaction(
            'UpdateAsset', 
            apartmentID, 
            response.EnergyUsage, 
            JSON.stringify(new Date(response.StartTime)), JSON.stringify(new Date(response.EndTime)), JSON.stringify(response.Latency)
        );
        allLatencyArray[i] = response.Latency;
        totalTime = totalTime + response.Latency;
        console.log(`\n*** UpdateAsset committed successfully - Average latency: ${totalTime/totalNodes}
            \n*** Highest latency: ${assetHigherEnergyUsage} asset: ${assetHigherID}
            \n*** Lowest latency: ${assetLowerEnergyUsage} asset: ${assetLowerID}`);
    }
    console.log(`\n*** All latency array: ${allLatencyArray} *****`);
}

// async function deleteAssetByID(contract: Contract): Promise<void>{
//     console.log(`\n--> Submit transaction: DeleteAsset, ${assetId}`);

//     await contract.submitTransaction('DeleteAsset', assetId);

//     console.log('\n*** DeleteAsset committed successfully');
// }

// OracleUpdateAsset(ctx, id, shipment_date, longitude, latitude) 
// async function oracleUpdateAsset(contract: Contract, asset: any): Promise<void> {
//     try {
//         console.log(`\n--> Submit transaction: oracleUpdateAsset, ${asset.ID}`);

//         const result = await CallOracle();

//         const data = JSON.parse(result);
        
//         console.log(`This is the oracle data: ${data.Summary.Phrase}`);
//         console.log(`This is the oracle data: ${data.Summary.TypeId}`);


//         await contract.submitTransaction('OracleUpdateAsset',asset.ID, data.Summary.Phrase, JSON.stringify(data.Summary.TypeId));

//         console.log('\n*** oracleUpdateAsset committed successfully');
//     } catch (error) {
//         console.log(`\n--> Error transaction in: oracleUpdateAsset, ${error}`);
//     }
    
// }

// async function CallOracle(): Promise<any> {
//     try {
        
//         const data = await fetch(
//             'http://dataservice.accuweather.com/forecasts/v1/minute?q=-36.8485%2C174.7633&apikey=CWC20d6lvG7IqIsz3OWRGwAtq1t004fB',
//             {
//                 method: 'GET'
//             })
//             .then((response) => response.json())
//             .then(async (data)=>{
//                 return data;
//             })
//         return JSON.stringify(data);
//     } catch (error) {
//         console.log('*** Successfully caught the error: \n', error);
//     } 

// }

async function replayChaincodeEvents(network: Network, contract:Contract, startBlock: bigint): Promise<void> {
    console.log('\n*** Start chaincode event replay');
    
    const events = await network.getChaincodeEvents(chaincodeName, {
        startBlock,
    });

    try {
        for await (const event of events) {
            const payload = parseJson(event.payload);
            console.log(`\n<-- Chaincode event replayed: ${event.eventName} -`, payload);

            // if (event.eventName === 'UpdateAsset') {
            //     oracleUpdateAsset(contract, payload);
            // }

            if (event.eventName === 'DeleteAsset') {
                // Reached the last submitted transaction so break to stop listening for events
                break;
            }
        }
    } finally {
        events.close();
    }
}
