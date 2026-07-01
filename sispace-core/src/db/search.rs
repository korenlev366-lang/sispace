use std::collections::{HashMap, HashSet};
use std::time::Instant;

use rusqlite::{params, Connection, Result as SqlResult};

use crate::db::messages::{self, TaskMessage};
use crate::models::search::{
    TaskSearchBrowseResult, TaskSearchDiscoveryResult, TaskSearchHit, TaskSearchScrollResult,
};

const CONTEXT_WINDOW: i64 = 5;
const BOOKEND_COUNT: usize = 3;

pub fn fts_query_terms(raw: &str) -> String {
    raw.split_whitespace()
        .filter(|w| w.len() >= 2)
        .map(|w| {
            let cleaned: String = w
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("\"{}\"", cleaned)
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub fn discovery_search(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> SqlResult<TaskSearchDiscoveryResult> {
    let started = Instant::now();
    let fts = fts_query_terms(query);
    if fts.is_empty() {
        return Ok(TaskSearchDiscoveryResult {
            query: query.to_string(),
            hits: Vec::new(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    let mut stmt = conn.prepare(
        "SELECT tm.task_id, tm.id, tm.role, tm.content, tm.created_at,
                snippet(task_messages_fts, 0, '[[', ']]', '…', 48) AS snip,
                bm25(task_messages_fts) AS score
         FROM task_messages_fts
         JOIN task_messages tm ON tm.id = task_messages_fts.rowid
         WHERE task_messages_fts MATCH ?1
         ORDER BY score
         LIMIT ?2",
    )?;

    let cap = (limit * 8).max(40) as i64;
    let rows = stmt.query_map(params![fts, cap], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, f64>(6)?,
        ))
    })?;

    let mut best_by_task: HashMap<String, (f64, i64, String)> = HashMap::new();
    for row in rows {
        let (task_id, msg_id, _role, _content, _created, snippet, score) = row?;
        best_by_task
            .entry(task_id)
            .and_modify(|existing| {
                if score < existing.0 {
                    *existing = (score, msg_id, snippet.clone());
                }
            })
            .or_insert((score, msg_id, snippet));
    }

    let mut ranked: Vec<(String, f64, i64, String)> = best_by_task
        .into_iter()
        .map(|(task_id, (score, msg_id, snippet))| (task_id, score, msg_id, snippet))
        .collect();
    ranked.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(limit);

    let mut hits = Vec::new();
    for (task_id, score, match_id, snippet) in ranked {
        let (title, status, task_type) = conn.query_row(
            "SELECT title, status, task_type FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        let bookend_start = messages::list_messages(conn, &task_id)?
            .into_iter()
            .take(BOOKEND_COUNT)
            .collect();

        let match_window = messages::messages_around(conn, &task_id, match_id, CONTEXT_WINDOW)?;

        hits.push(TaskSearchHit {
            task_id,
            title,
            status,
            task_type,
            snippet,
            match_message_id: Some(match_id),
            bookend_start,
            match_window,
            score,
        });
    }

    Ok(TaskSearchDiscoveryResult {
        query: query.to_string(),
        hits,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

pub fn scroll_messages(
    conn: &Connection,
    task_id: &str,
    before: Option<i64>,
    after: Option<i64>,
    limit: usize,
) -> SqlResult<TaskSearchScrollResult> {
    let limit_i = limit as i64;

    let messages = if let Some(before_id) = before {
        let mut stmt = conn.prepare(
            "SELECT id, task_id, run_id, role, content, created_at
             FROM task_messages
             WHERE task_id = ?1 AND id < ?2
             ORDER BY id DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![task_id, before_id, limit_i], map_message_row)?;
        let mut list: Vec<TaskMessage> = rows.collect::<Result<_, _>>()?;
        list.reverse();
        list
    } else if let Some(after_id) = after {
        let mut stmt = conn.prepare(
            "SELECT id, task_id, run_id, role, content, created_at
             FROM task_messages
             WHERE task_id = ?1 AND id > ?2
             ORDER BY id ASC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![task_id, after_id, limit_i], map_message_row)?;
        rows.collect::<Result<Vec<_>, rusqlite::Error>>()?
    } else {
        messages::list_messages(conn, task_id)?
            .into_iter()
            .rev()
            .take(limit)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    };

    let min_id = messages.first().map(|m| m.id);
    let max_id = messages.last().map(|m| m.id);

    let has_before = match min_id {
        Some(id) => {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM task_messages WHERE task_id = ?1 AND id < ?2",
                params![task_id, id],
                |row| row.get(0),
            )?;
            count > 0
        }
        None => false,
    };

    let has_after = match max_id {
        Some(id) => {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM task_messages WHERE task_id = ?1 AND id > ?2",
                params![task_id, id],
                |row| row.get(0),
            )?;
            count > 0
        }
        None => false,
    };

    Ok(TaskSearchScrollResult {
        task_id: task_id.to_string(),
        messages,
        has_before,
        has_after,
    })
}

pub fn browse_messages(
    conn: &Connection,
    task_id: &str,
    limit: usize,
    offset: usize,
) -> SqlResult<TaskSearchBrowseResult> {
    let total: usize = conn.query_row(
        "SELECT COUNT(*) FROM task_messages WHERE task_id = ?1",
        params![task_id],
        |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT id, task_id, run_id, role, content, created_at
         FROM task_messages
         WHERE task_id = ?1
         ORDER BY id ASC
         LIMIT ?2 OFFSET ?3",
    )?;
    let rows = stmt.query_map(
        params![task_id, limit as i64, offset as i64],
        map_message_row,
    )?;
    let messages: Vec<TaskMessage> = rows.collect::<Result<Vec<_>, rusqlite::Error>>()?;

    Ok(TaskSearchBrowseResult {
        task_id: task_id.to_string(),
        messages,
        total,
        offset,
        limit,
    })
}

fn map_message_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskMessage> {
    Ok(TaskMessage {
        id: row.get(0)?,
        task_id: row.get(1)?,
        run_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn find_related_task_ids(
    conn: &Connection,
    exclude_id: &str,
    title: &str,
    goal: &str,
    limit: usize,
) -> SqlResult<Vec<String>> {
    let mut ids: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(exclude_id.to_string());

    let search_text = format!("{title} {goal}");
    let fts = fts_query_terms(&search_text);
    if !fts.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT tm.task_id, bm25(task_messages_fts) AS score
             FROM task_messages_fts
             JOIN task_messages tm ON tm.id = task_messages_fts.rowid
             WHERE task_messages_fts MATCH ?1 AND tm.task_id != ?2
             ORDER BY score
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![fts, exclude_id, limit as i64], |row| {
            row.get::<_, String>(0)
        })?;
        for row in rows {
            let id: String = row?;
            if seen.insert(id.clone()) {
                ids.push(id);
            }
        }
    }

    for word in search_text.split_whitespace().filter(|w| w.len() >= 3) {
        let pattern = format!("%{word}%");
        let mut stmt = conn.prepare(
            "SELECT id FROM tasks
             WHERE id != ?1 AND (title LIKE ?2 OR id IN (
               SELECT task_id FROM task_messages WHERE content LIKE ?2
             ))
             ORDER BY updated_at DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![exclude_id, pattern, limit as i64], |row| {
            row.get::<_, String>(0)
        })?;
        for row in rows {
            let id: String = row?;
            if seen.insert(id.clone()) {
                ids.push(id);
            }
            if ids.len() >= limit {
                break;
            }
        }
        if ids.len() >= limit {
            break;
        }
    }

    ids.truncate(limit);
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::messages;
    use crate::db::tasks::{insert_task, new_task_id};
    use crate::models::task::TaskCreateInput;

    fn seed_messages(conn: &Connection, task_id: &str, count: usize) {
        for i in 0..count {
            let content = if i % 17 == 0 {
                format!("auth middleware token validation step {i}")
            } else {
                format!("routine log line {i}")
            };
            messages::insert_message(conn, task_id, "assistant", &content, None).unwrap();
        }
    }

    #[test]
    fn discovery_finds_auth_tasks_under_50ms_on_1k_messages() {
        let path = std::env::temp_dir().join(format!("sispace-fts-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();

        for n in 0..4 {
            let input = TaskCreateInput {
                title: format!("Task {n}"),
                task_type: "feature".into(),
                project_root: Some("/tmp".into()),
                goal: None,
            };
            let id = new_task_id(&conn).unwrap();
            insert_task(&conn, &id, &input, "SISpace/tasks/x.md").unwrap();
            seed_messages(&conn, &id, 250);
        }

        let result = discovery_search(&conn, "auth middleware", 5).unwrap();
        assert!(result.elapsed_ms < 50, "took {}ms", result.elapsed_ms);
        assert!(!result.hits.is_empty());
        assert!(result.hits[0].snippet.contains("auth") || result.hits[0].match_window.iter().any(|m| m.content.contains("auth")));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn scroll_and_browse_paginate() {
        let path = std::env::temp_dir().join(format!("sispace-scroll-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = crate::db::open(&path).unwrap();
        let input = TaskCreateInput {
            title: "Scroll test".into(),
            task_type: "feature".into(),
            project_root: None,
            goal: None,
        };
        let id = new_task_id(&conn).unwrap();
        insert_task(&conn, &id, &input, "SISpace/tasks/x.md").unwrap();
        for i in 0..10 {
            messages::insert_message(&conn, &id, "system", &format!("msg {i}"), None).unwrap();
        }

        let browse = browse_messages(&conn, &id, 3, 0).unwrap();
        assert_eq!(browse.messages.len(), 3);
        assert_eq!(browse.total, 10);

        let all = messages::list_messages(&conn, &id).unwrap();
        let mid = all[5].id;
        let scroll = scroll_messages(&conn, &id, Some(mid), None, 2).unwrap();
        assert_eq!(scroll.messages.len(), 2);

        let _ = std::fs::remove_file(path);
    }
}
