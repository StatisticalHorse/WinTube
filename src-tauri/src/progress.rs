use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Per-video stop points. YouTube does not hand its saved position to
/// third-party clients through InnerTube, so WinTube keeps its own: the player
/// reports where playback stopped and asks for it again the next time the same
/// video opens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub seconds: f64,
    pub duration: f64,
    pub updated: u64,
}

struct Store {
    path: PathBuf,
    entries: HashMap<String, Position>,
}

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();

pub fn init(dir: PathBuf) {
    let path = dir.join("playback.json");
    let entries = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<HashMap<String, Position>>(&bytes).ok())
        .unwrap_or_default();
    let _ = STORE.set(Mutex::new(Store { path, entries }));
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

/// Returns the point to start at, or `None` when starting from the beginning
/// makes sense: no saved point, only a few seconds in, or practically finished.
pub fn get(id: &str) -> Option<f64> {
    let store = STORE.get()?.lock().ok()?;
    let entry = store.entries.get(id)?;
    if entry.seconds < 5.0 {
        return None;
    }
    if entry.duration > 0.0 && entry.seconds >= entry.duration - 10.0 {
        return None;
    }
    Some(entry.seconds)
}

pub fn set(id: &str, seconds: f64, duration: f64) {
    let Some(store) = STORE.get() else {
        return;
    };
    let Ok(mut store) = store.lock() else {
        return;
    };

    if duration > 0.0 && seconds >= duration - 10.0 {
        store.entries.remove(id);
    } else {
        store.entries.insert(
            id.to_string(),
            Position {
                seconds,
                duration,
                updated: now(),
            },
        );
        if store.entries.len() > 500 {
            let mut order: Vec<(u64, String)> = store
                .entries
                .iter()
                .map(|(id, entry)| (entry.updated, id.clone()))
                .collect();
            order.sort_by_key(|(updated, _)| *updated);
            for (_, id) in order.into_iter().take(store.entries.len() - 400) {
                store.entries.remove(&id);
            }
        }
    }

    save(&store);
}

pub fn clear(id: &str) {
    let Some(store) = STORE.get() else {
        return;
    };
    let Ok(mut store) = store.lock() else {
        return;
    };
    if store.entries.remove(id).is_some() {
        save(&store);
    }
}

fn save(store: &Store) {
    if let Some(parent) = store.path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_vec(&store.entries) {
        let _ = fs::write(&store.path, json);
    }
}
