/*************************************************************************
 *  (C) Copyright Mojaloop Foundation. 2024 - All rights reserved.        *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - jbush@mojaloop.io                                   *
 *                                                                        *
 *  CONTRIBUTORS:                                                         *
 *       James Bush - jbush@mojaloop.io                                   *
 *************************************************************************/

import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
    linger: true,
    scenarios: {
        endToEndSendMoney: {
            executor: 'shared-iterations',
            vus: 12,
            iterations: 1000,
        }
    }
};

const TestUsers = [];

for(let n = 1234000001; n < 1234000128; n++) {
    TestUsers.push({
        msisdn: `0${n}`
    });
}

// hack to generate a UUID. necessary as k6 doesnt expose a nicer UUID generation option
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = (Math.random() * 16) | 0,
            v = c == 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// sends a party lookup to the ml-connectors outbound simplified API
const getParty = () => {
    const res = http.get('http://mojaloop-connector-load-test:4001/parties/MSISDN/1234567890');

    let parsedBody = JSON.parse(res.body);

    check(res, {
        'returns 200': (r) => r.status === 200,
        'party name as expected': (r) => parsedBody.party.body.name === 'Test User',
    });
};

const params = {
    headers: {
        "Content-Type": 'application/json',
    }
};


// sends a transfer request to the ml-connectors outbound "simplified" API
const postTransfer = () => {
    const requestBody = {
        from: {
            idType: 'MSISDN',
            idValue: '0987654321',
            displayName: 'K6 LoadTester',
        },
        to: {
            idType: 'MSISDN',
            //idValue: '1234567890',
        },
        amountType: 'SEND',
        currency: 'KES',
        amount: '10',
        transactionType: 'TRANSFER',
        note: 'k6 load test transfer',
        homeTransactionId: generateUUID(),
    };

    const randomUser = randomItem(TestUsers);
    requestBody.to.idValue = randomUser.msisdn;

    // send a transfer request to the ml-connectors outbound "simplified" api. This should execute all three
    // mojaloop transfer stages as we set the ml-connector config to auto accept parties and quotes.
    const res = http.post('http://mojaloop-connector-load-test:4001/transfers', JSON.stringify(requestBody), params);

    let parsedBody = JSON.parse(res.body);

    check(res, {
        'returns 200': (r) => r.status === 200,
        'transfer completed': (r) => parsedBody.currentState === 'COMPLETED',
    })
};

sleep(10);

export default function () {
    postTransfer();
}