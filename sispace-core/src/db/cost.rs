use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SessionCostRow {
    pub session_id: String,
    pub project_key: String,
    pub output_tokens: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectCostRow {
    pub project_key: String,
    pub output_tokens: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CostSummary {
    pub sessions: Vec<SessionCostRow>,
    pub projects: Vec<ProjectCostRow>,
    pub project_total_tokens: i64,
    pub daily_burn_tokens: i64,
    pub monthly_allowance_tokens: i64,
    pub usage_percent: f64,
}

fn ensure_cost_tables(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS cli_session_costs (
            session_id TEXT PRIMARY KEY,
            project_key TEXT NOT NULL,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cli_session_costs_project ON cli_session_costs(project_key);
        CREATE TABLE IF NOT EXISTS cli_project_costs (
            project_key TEXT PRIMARY KEY,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )?;
    Ok(())
}

pub fn load_cost_summary(
    conn: &Connection,
    monthly_allowance_tokens: i64,
) -> SqlResult<CostSummary> {
    ensure_cost_tables(conn)?;

    let mut stmt = conn.prepare(
        "SELECT session_id, project_key, output_tokens, updated_at
         FROM cli_session_costs
         ORDER BY updated_at DESC
         LIMIT 50",
    )?;
    let sessions: Vec<SessionCostRow> = stmt
        .query_map([], |row| {
            Ok(SessionCostRow {
                session_id: row.get(0)?,
                project_key: row.get(1)?,
                output_tokens: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<SqlResult<Vec<_>>>()?;

    let mut stmt = conn.prepare(
        "SELECT project_key, output_tokens, updated_at
         FROM cli_project_costs
         ORDER BY output_tokens DESC",
    )?;
    let projects: Vec<ProjectCostRow> = stmt
        .query_map([], |row| {
            Ok(ProjectCostRow {
                project_key: row.get(0)?,
                output_tokens: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?
        .collect::<SqlResult<Vec<_>>>()?;

    let project_total_tokens: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(output_tokens), 0) FROM cli_project_costs",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let daily_burn_tokens: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(output_tokens), 0) FROM cli_session_costs
             WHERE updated_at >= datetime('now', '-1 day')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let allowance = monthly_allowance_tokens.max(1);
    let usage_percent =
        (project_total_tokens as f64 / allowance as f64 * 100.0).min(100.0);

    Ok(CostSummary {
        sessions,
        projects,
        project_total_tokens,
        daily_burn_tokens,
        monthly_allowance_tokens: allowance,
        usage_percent,
    })
}
