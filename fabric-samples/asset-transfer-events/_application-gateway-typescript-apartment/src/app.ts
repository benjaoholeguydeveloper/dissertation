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
const chaincodeName = 'apartment';

const utf8Decoder = new TextDecoder();
const assetId = 'Apartment0';


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
        await deleteAssetByID(contract);

        // Replay events from the block containing the first transaction
        await replayChaincodeEvents(network,firstBlockNumber);
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
    let randomInteger = Math.floor(Math.random() * (250 - 20 + 1)) + 20;

    console.log(`\n--> Submit Transaction: CreateAsset, ${assetId} with energy usage value ${randomInteger}`);

    const result = await contract.submitAsync('CreateAsset', {
        arguments: [ assetId, JSON.stringify(randomInteger) ],
    });

    const status = await result.getStatus();
    if (!status.successful) {
        throw new Error(`failed to commit transaction ${status.transactionId} with status code ${String(status.code)}`);
    }

    console.log('\n*** CreateAsset committed successfully');

    for (let i = 0; i < 10000; i++) {
        randomInteger = Math.floor(Math.random() * (250 - 20 + 1)) + 20;
        const apartmentID = `Apartment${i + 1}`;
        console.log(`\n--> Submit Transaction: CreateAsset, ${apartmentID} with energy usage value ${randomInteger}`);

        const result = await contract.submitAsync('CreateAsset', {
            arguments: [ apartmentID, JSON.stringify(randomInteger) ],
        });
    
        const status = await result.getStatus();
        if (!status.successful) {
            throw new Error(`failed to commit transaction ${status.transactionId} with status code ${String(status.code)}`);
        }
    
        console.log('\n*** CreateAsset committed successfully');
    }

    return status.blockNumber;
}

async function deleteAssetByID(contract: Contract): Promise<void>{
    console.log(`\n--> Submit transaction: DeleteAsset, ${assetId}`);

    await contract.submitTransaction('DeleteAsset', assetId);

    console.log('\n*** DeleteAsset committed successfully');
}

async function replayChaincodeEvents(network: Network, startBlock: bigint): Promise<void> {
    console.log('\n*** Start chaincode event replay');
    
    const events = await network.getChaincodeEvents(chaincodeName, {
        startBlock,
    });

    try {
        for await (const event of events) {
            const payload = parseJson(event.payload);
            console.log(`\n<-- Chaincode event replayed: ${event.eventName} -`, payload);

            if (event.eventName === 'DeleteAsset') {
                // Reached the last submitted transaction so break to stop listening for events
                break;
            }
        }
    } finally {
        events.close();
    }
}
