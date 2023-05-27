#!/usr/bin/env node
/* eslint-disable no-await-in-loop */

const fs = require('fs');
const yargs = require('yargs/yargs');
const readline = require('readline');
const childProcess = require('child_process');

const { argv } = yargs(process.argv.slice(2))
  .alias('h', 'historyPath')
  .alias('p', 'serverPort')
  .alias('s', 'serverPath')
  .alias('m', 'modelPath')
  .alias('l', 'lines') // How many lines to use
  .default({
    historyPath: '/Users/shank/.llama-whisperer/history',
    serverPort: '3000',
    serverPath: '/Users/shank/repos/llama.cpp/bin/server',
    modelPath: '/Users/shank/repos/llama.cpp/models/stable-vicuna-13B.ggmlv3.q8_0.bin',
    linesToUse: 2,
  });

const {
  historyPath, serverPort, serverPath, modelPath, linesToUse,
} = argv;

const prompt = 'The following is commands and output from a Zsh terminal. In the Response, provide a concise analysis of it and debug any errors. Restricted to 50 words or less.';

const stopWords = ['###', 'Question:', 'Human:', 'Assistant:'];

async function ask(instruction) {
  const fullPrompt = `${prompt}\n### Instructions:${instruction}\n\n### Response:\n\n`;
  process.stdout.write(fullPrompt);

  await fetch(`http://127.0.0.1:${serverPort}/completion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      batch_size: 512,
      top_k: 40,
      top_p: 0.9,
      n_keep: 0,
      n_predict: 100,
      stop: stopWords,
      exclude: [],
      threads: 8,
      as_loop: true,
      interactive: false,
    }),
  });

  let shouldStop = false;
  while (!shouldStop) {
    const response = await fetch(`http://127.0.0.1:${serverPort}/next-token`);
    const result = await response.json();
    const nextToken = result.content;

    shouldStop = result.stop;
    if (stopWords.some((word) => nextToken.includes(word))) {
      await fetch(`http://127.0.0.1:${serverPort}/next-token?stop=true`);
      shouldStop = true;
    }
    process.stdout.write(nextToken);
  }
}

async function readFile(file) {
  return new Promise((resolve) => {
    const lines = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lines.push(line);
    });

    rl.once('close', () => {
      resolve(lines);
    });
  });
}

function sanitizeLines(lines) {
  const sanitizedText = lines.map((line) => line.replace(/\s\s+/g, ' ').trim()).filter((line) => line && !line.includes('Script started on') && !line.startsWith('Script done on'));
  return sanitizedText;
}
async function main() {
  const file = await readFile(historyPath);
  const input = sanitizeLines(file).slice(-1 * linesToUse);
  await ask(input);
  process.exit();
}

const childArgs = ['-m', modelPath, '--ctx_size', '2048', '--port', serverPort];

const abortController = new AbortController();
const { signal } = abortController;
const child = childProcess.execFile(serverPath, childArgs, {
  signal,
}, (error, stdout, stderr) => {
  if (error) {
    process.stderr.write(error.toString());
    process.exit();
  }
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
});

main();

process.on('SIGINT', () => {
  process.stdout.write('Killing server and listener');
  abortController.abort();
  process.exit();
});

child.on('exit', (code) => {
  process.stderr.write(`Child process exited with code ${code}`);
});
