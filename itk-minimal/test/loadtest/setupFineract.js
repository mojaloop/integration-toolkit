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

const axios = require('axios');

// Fineract API base URL and authentication details
const FINERACT_API_BASE_URL = 'http://localhost:8080/fineract-provider/api/v1';
const username = 'mifos';
const password = 'password';
const tenant = 'default';  // Replace with your tenant identifier if needed

function getNow() {
    const date = new Date()
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

const now = getNow();


// Authenticate with the Fineract API
async function authenticate() {
    try {
        const response = await axios({
            method: 'post',
            url: `${FINERACT_API_BASE_URL}/authentication`,
            data: {
                username,
                password
            },
            headers: {
                'Fineract-Platform-TenantId': tenant
            }
        });
        return response.data.base64EncodedAuthenticationKey;
    } catch (error) {
        console.error('Authentication failed:', error.message);
        throw error;
    }
}

// Create a savings account for a client
async function createSavingsAccount(clientId, productId, authToken) {
    const data = {
        clientId: clientId,
        productId: productId,  // ID of the savings product to apply
        submittedOnDate: now,
        dateFormat: 'yyyy-MM-dd',
        locale: 'en',
        nominalAnnualInterestRate: 1.5,
        interestCompoundingPeriodType: 1, // Monthly compounding
        interestPostingPeriodType: 1,     // Monthly posting
        interestCalculationType: 1,       // Daily balance
        interestCalculationDaysInYearType: 365,
        minRequiredOpeningBalance: 100,
        lockinPeriodFrequency: 0,
        lockinPeriodFrequencyType: 0,
        withdrawalFeeForTransfers: false,
    };

    try {
        const response = await axios({
            method: 'post',
            url: `${FINERACT_API_BASE_URL}/savingsaccounts`,
            headers: {
                'Fineract-Platform-TenantId': tenant,
                'Authorization': `Basic ${authToken}`,
                'Content-Type': 'application/json'
            },
            data: data
        });
        console.log('Savings account created successfully:', response.data);
        return response.data.savingsId;
    } catch (error) {
        console.error('Failed to create savings account:', error.message);
        throw error;
    }
}

// Approve a savings account for a client
async function approveSavingsAccount(accountId, authToken) {
    const data = {
        approvedOnDate: now,
        dateFormat: 'yyyy-MM-dd',
        locale: 'en',
    };

    try {
        const response = await axios({
            method: 'post',
            url: `${FINERACT_API_BASE_URL}/savingsaccounts/${accountId}?command=approve`,
            headers: {
                'Fineract-Platform-TenantId': tenant,
                'Authorization': `Basic ${authToken}`,
                'Content-Type': 'application/json'
            },
            data: data
        });
        console.log('Savings account approved successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Failed to approve savings account:', error.message);
        throw error;
    }
}

// Activate a savings account for a client
async function activateSavingsAccount(accountId, authToken) {
    const data = {
        activatedOnDate: now,
        dateFormat: 'yyyy-MM-dd',
        locale: 'en',
    };

    try {
        const response = await axios({
            method: 'post',
            url: `${FINERACT_API_BASE_URL}/savingsaccounts/${accountId}?command=activate`,
            headers: {
                'Fineract-Platform-TenantId': tenant,
                'Authorization': `Basic ${authToken}`,
                'Content-Type': 'application/json'
            },
            data: data
        });
        console.log('Savings account activated successfully:', response.data);
        return response.data;
    } catch (error) {
        console.error('Failed to activate savings account:', error.message);
        throw error;
    }
}

// Create a savings product
async function createSavingsProduct(authToken) {
    const savingsProductData = {
        name: 'Standard Savings Product',
        shortName: 'SSP',
        description: 'A standard savings product',
        currencyCode: 'KES',
        digitsAfterDecimal: 2,
        interestCompoundingPeriodType: 1, // Daily
        interestPostingPeriodType: 1,    // Monthly
        interestCalculationType: 1,      // Daily Balance
        interestCalculationDaysInYearType: 365,
        minRequiredOpeningBalance: 0,
        lockinPeriodFrequency: 0,
        lockinPeriodFrequencyType: 0,
        accountingRule: 1, // Cash-based accounting
        locale: 'en',
        nominalAnnualInterestRate: 5,
    };

    try {
        const response = await axios({
            method: 'post',
            url: `${FINERACT_API_BASE_URL}/savingsproducts`,
            headers: {
                'Fineract-Platform-TenantId': tenant,
                'Authorization': `Basic ${authToken}`,
                'Content-Type': 'application/json'
            },
            data: savingsProductData
        });
        console.log('Savings product created successfully:', response.data);
        return response.data.resourceId; // Return the product ID
    } catch (error) {
        console.error('Failed to create savings product:', error.message);
        throw error;
    }
}

// Create a new client
async function createClient(authToken, clientData) {
    try {
        const response = await axios({
            method: 'post',
            url: `${FINERACT_API_BASE_URL}/clients`,
            headers: {
                'Fineract-Platform-TenantId': tenant,
                'Authorization': `Basic ${authToken}`,
                'Content-Type': 'application/json'
            },
            data: clientData
        });
        console.log('Client created successfully:', response.data);
        return response.data.clientId; // Return the new client's ID
    } catch (error) {
        console.error('Failed to create client:', error.message);
        throw error;
    }
}

const createMsisdn = (base, idx) => {
    if (typeof base !== "string" || typeof idx !== "number" ) {
        throw new Error("Invalid input: Ensure base is a string and integer is a number");
    }

    if (idx < 0 || idx > 9999) {
        throw new Error("Invalid integer: Expected a value in the range 0 to 9999.");
    }

    const integerString = idx.toString();
    const paddingLength = 4 - integerString.length; // Max length for integers is 4 (0000 to 9999).
    const zeroPaddedInteger = "0".repeat(paddingLength) + integerString;

    return base + zeroPaddedInteger;
};

// Main function to execute
(async () => {
    try {
        const authToken = await authenticate();
        const productId = await createSavingsProduct(authToken);

        for(let i = 1; i < 128; i++) {
            const clientData = {
                firstname: `ClientFirst${i}`,
                lastname: `ClientLast${i}`,
                mobileNo: createMsisdn('0123400', i),
                officeId: 1, // default head office
                externalId: `EXTID${i}`,
                dateOfBirth: '1990-01-01',
                active: true,
                activationDate: now,
                dateFormat: 'yyyy-MM-dd',
                locale: 'en',
                legalFormId: 1,
            };

            const clientId = await createClient(authToken, clientData);
            const savingsAccountId = await createSavingsAccount(clientId, productId, authToken);
            const approval = await approveSavingsAccount(savingsAccountId, authToken);
            const activation = await activateSavingsAccount(savingsAccountId, authToken);
            console.log(`Created client ${clientId} with savings account ${savingsAccountId}`);
        }
        console.log('Complete.')
    } catch (error) {
        console.error('Error:', error.message);
    }
})();
