-- Where each chat turn's filters came from, for the /metrics page (used_llm alone can't tell a cache hit from the
-- keyword fallback). NULL on turns logged before this column existed.
ALTER TABLE chat_messages ADD COLUMN source TEXT
  CHECK (source IN ('llm', 'fallback', 'cache_exact', 'cache_similar', 'similar'));

-- Old turns: LLM turns and "More like X" turns are known; the rest were either fallback or cache, so stay NULL.
UPDATE chat_messages SET source = 'llm' WHERE used_llm;
UPDATE chat_messages m SET source = 'similar'
  WHERE NOT used_llm AND role = 'user' AND content LIKE 'More like %';
