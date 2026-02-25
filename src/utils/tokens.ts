/**
 * Simple token estimation utility.
 * For English, 1 token is roughly 4 characters.
 * For CJK (Chinese, Japanese, Korean), 1 token is roughly 0.5 to 1 character depending on the model.
 * To be safe, we'll use a conservative estimate.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Count CJK characters
  const cjkRegex = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
  const cjkMatch = text.match(cjkRegex);
  const cjkCount = cjkMatch ? cjkMatch.length : 0;
  
  // Rest of the text (mostly English/Symbols)
  const nonCjkText = text.replace(cjkRegex, '');
  const nonCjkTokenEstimate = Math.ceil(nonCjkText.length / 4);
  
  // CJK tokens: often 1 token per character in many modern models (like Qwen, DeepSeek)
  // but sometimes more. We'll use 1.2 to be safe.
  const cjkTokenEstimate = Math.ceil(cjkCount * 1.2);
  
  return nonCjkTokenEstimate + cjkTokenEstimate;
}

export function estimateMessagesTokens(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          total += estimateTokens(part.text);
        } else if (part.type === 'image_url') {
          total += 1000; // Rough estimate for an image
        }
      }
    }
    
    // Tool calls and results
    if (msg.tool_calls) {
      total += estimateTokens(JSON.stringify(msg.tool_calls));
    }
    if (msg.tool_call_id) {
      total += 20; // metadata
    }
  }
  return total;
}
