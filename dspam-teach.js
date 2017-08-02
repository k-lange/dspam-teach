#!/usr/bin/env node

const db = require('dirty')('dspam-teach.db');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { set, map, zip, filter, merge } = require('lodash/fp');
const { MailParser } = require('mailparser');
const { spamDir, innocentDir, age } = require('yargs').argv;

const readdir = promisify(fs.readdir);
const setDirType = set('dirType');

db.on('load', () => getTypedMails().then(learn));

function learn(mails) {
    mails.forEach(({ dirType, dspamType, subject }) => {
        if (dirType === 'innocent' && dspamType === 'spam') {
            console.log(`reclassify '${subject}' as innocent`);
        } else if (dirType === 'spam' && dspamType === 'innocent') {
            console.log(`reclassify '${subject}' as spam`);
        } else if (dirType === 'innocent' && !dspamType) {
            console.log(`classify '${subject}' as innocent`);
        } else if (dirType === 'spam' && !dspamType) {
            console.log(`classify '${subject}' as spam`);
        }
    });
}

async function getTypedMails() {
    return getMails()
        .then(({ spam, innocent }) => [...map(setDirType('spam'), spam), ...map(setDirType('innocent'), innocent)])
        .then(filter(validFilenameFilter))
        .then(addDbType)
        .then(filter(inTimeframeFilter))
        .then(filter(({ dbType, dirType }) => dbType !== dirType))
        .then(addHeaders);
}

// function learnMail(type, { filename, filepath }) {
//     const id = getId(filename);
//     dbPut(filename, type);
// }

async function addHeaders(mails) {
    const headers = await Promise.all(map(getHeaders, mails));
    return map(([mail, headers]) => merge(mail, headers), zip(mails, headers));
}

function addDbType(mails) {
    const types = map(getOldType, mails);
    return map(([mail, dbType]) => set('dbType', dbType, mail), zip(mails, types));
}

async function getMails() {
    const [spam, innocent] = await Promise.all([getFiles(spamDir), getFiles(innocentDir)]);
    const readInnocent = filter(unreadFilter, innocent);
    return { spam, innocent: readInnocent };
}

async function getFiles(dir) {
    const files = await readdir(dir);
    return map(filename => ({ filename, filepath: path.resolve(dir, filename) }), files);
}

function unreadFilter({ filename }) {
    return filename.split(',').pop().indexOf('S') !== -1;
}

function validFilenameFilter({ filename }) {
    return filename.split('.').length >= 3 && filename.split(',').length >= 3;
}

function inTimeframeFilter({ filename }) {
    const date = filename.split('.')[0] * 1000;
    return Date.now() - date <= age * 24 * 60 * 60 * 1000;
}

function getOldType({ filename }) {
    const id = getId(filename);
    return db.get(id);
}

function getId(filename) {
    return filename.split(',')[0];
}

function getHeaders({ filepath }) {
    return new Promise((resolve, reject) => {
        const parser = new MailParser();

        parser.on('headers', headers => {
            const dspamType = (headers.get('x-dspam-result') || '').toLowerCase();
            const subject = headers.get('subject');
            resolve({ dspamType, subject });
        });

        fs.createReadStream(filepath).pipe(parser).on('error', reject);
    });
}
