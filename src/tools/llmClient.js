/**
 * tools/llmClient.js
 * Groq SDK wrapper with cost tracking (token logging),
 * JSON-specific variant with retry, and embedding approximation.
 */

import Groq from 'groq-sdk';
import logger from '../middleware/logger.js';
import { generateTextWithGemini } from './geminiClient.js';

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.3;

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.GROQ_API_KEY) {
      logger.error('GROQ_API_KEY is missing from environment variables');
    }
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

/**
 * Core LLM call via Groq. Returns the text content of the first message.
 * Logs prompt/completion token usage on every call.
 */
export async function askLLM(systemPrompt, userMessage, options = {}) {
  const {
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    label = 'unlabeled',
  } = options;

  try {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
    });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    // Log token usage (Groq is significantly cheaper, prices here are illustrative)
    logger.info(`Groq [${label}] tokens — prompt: ${promptTokens}, completion: ${completionTokens}`);

    return response.choices[0]?.message?.content || '';
  } catch (err) {
    logger.error(`Groq API error [${label}]: ${err.message}`);
    try {
      const text = await generateTextWithGemini(systemPrompt, userMessage, {
        maxTokens,
        temperature,
      });
      logger.info(`Gemini fallback completed [${label}]`);
      return text;
    } catch (fallbackErr) {
      logger.error(`Gemini fallback failed [${label}]: ${fallbackErr.message}`);
      throw new Error(`Groq failed (${err.message}); Gemini fallback failed (${fallbackErr.message})`, {
        cause: fallbackErr,
      });
    }
  }
}

/**
 * Calls LLM and parses the response as JSON.
 * Automatically retries once with a stricter prompt if JSON.parse fails.
 */
export async function askLLMJSON(systemPrompt, userMessage, options = {}) {
  const strictInstruction = '\n\nCRITICAL: Return raw JSON only. No ```json wrapper. No backticks. No markdown. No explanation. Start your response with { and end with }. Your entire response must be parseable by JSON.parse() with no pre-processing.';

  const attempt = async (sys) => {
    const text = await askLLM(sys + strictInstruction, userMessage, {
      ...options,
      temperature: 0.1,
      label: options.label || 'json',
    });
    // Remove potential markdown code blocks if the LLM ignores the strict instruction
    const cleanText = text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(cleanText);
  };

  try {
    return await attempt(systemPrompt);
  } catch (firstErr) {
    logger.warn(`LLM JSON parse failed (attempt 1): ${firstErr.message}. Retrying with stricter prompt.`);
    const stricterSystem = systemPrompt + '\n\nCRITICAL: Your response MUST be ONLY valid JSON. Any other text will cause a system crash. No explanation, no formatting, no code blocks.';
    try {
      return await attempt(stricterSystem);
    } catch (secondErr) {
      logger.error(`LLM JSON parse failed (attempt 2): ${secondErr.message}`);
      throw new Error(`Failed to get valid JSON from LLM after 2 attempts: ${secondErr.message}`);
    }
  }
}

/**
 * Generates a text embedding using TF-IDF approximation (locally computed).
 */
export async function getEmbedding(text) {
  return computeTFIDFVector(text);
}

// ─── Local TF-IDF Embedding Approximation ────────────────────────────────────

const VOCAB_SIZE = 512;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(token) {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) + hash) ^ token.charCodeAt(i);
  }
  return Math.abs(hash) % VOCAB_SIZE;
}

function computeTFIDFVector(text) {
  const tokens = tokenize(text);
  const vector = new Array(VOCAB_SIZE).fill(0);

  if (tokens.length === 0) return vector;

  const tf = {};
  for (const token of tokens) {
    const idx = hashToken(token);
    tf[idx] = (tf[idx] || 0) + 1;
  }

  // Normalize by total tokens (TF)
  for (const [idx, count] of Object.entries(tf)) {
    vector[parseInt(idx)] = count / tokens.length;
  }

  // Normalize L2
  const magnitude = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  if (magnitude > 0) {
    return vector.map(v => v / magnitude);
  }
  return vector;
}
