use std::time::Duration;

use snmp2::{AsyncSession, Oid, Value};
use tokio::time::timeout;

/// A printer that wakes from Energy Saver can take a few seconds to answer.
const TIMEOUT: Duration = Duration::from_secs(5);
/// Rows asked for per GETBULK round trip while walking a table.
const BULK_ROWS: u32 = 40;

/// A value copied out of the response buffer, which the session reuses.
pub enum SnmpValue {
    Int(i64),
    Text(String),
    Other,
}

impl SnmpValue {
    pub fn int(&self) -> Option<i64> {
        match self {
            SnmpValue::Int(n) => Some(*n),
            _ => None,
        }
    }

    pub fn text(self) -> Option<String> {
        match self {
            SnmpValue::Text(s) if !s.is_empty() => Some(s),
            _ => None,
        }
    }
}

fn own(value: Value<'_>) -> SnmpValue {
    match value {
        Value::Integer(n) => SnmpValue::Int(n),
        Value::Counter32(n) | Value::Unsigned32(n) | Value::Timeticks(n) => SnmpValue::Int(n.into()),
        Value::Counter64(n) => SnmpValue::Int(n as i64),
        Value::OctetString(bytes) => {
            SnmpValue::Text(String::from_utf8_lossy(bytes).trim().to_string())
        }
        _ => SnmpValue::Other,
    }
}

fn oid(arcs: &[u64]) -> Result<Oid<'static>, String> {
    Oid::from(arcs).map_err(|e| format!("OID không hợp lệ: {e:?}"))
}

fn arcs(oid: &Oid<'_>) -> Vec<u64> {
    oid.iter().map(|arcs| arcs.collect()).unwrap_or_default()
}

pub struct Snmp {
    session: AsyncSession,
}

impl Snmp {
    pub async fn connect(host: &str, community: &str) -> Result<Self, String> {
        let session = AsyncSession::new_v2c(format!("{host}:161"), community.as_bytes(), 0)
            .await
            .map_err(|e| format!("SNMP: {e}"))?;
        Ok(Self { session })
    }

    /// Reads several scalars at once; the values come back in the order asked.
    pub async fn get(&mut self, oids: &[&[u64]]) -> Result<Vec<SnmpValue>, String> {
        let oids = oids.iter().map(|arcs| oid(arcs)).collect::<Result<Vec<_>, _>>()?;
        let refs: Vec<&Oid<'_>> = oids.iter().collect();
        let pdu = timeout(TIMEOUT, self.session.get_many(&refs))
            .await
            .map_err(|_| "SNMP: máy in không trả lời".to_string())?
            .map_err(|e| format!("SNMP: {e:?}"))?;
        Ok(pdu.varbinds.map(|(_, value)| own(value)).collect())
    }

    /// Walks one table column. Each row comes back with the OID arcs that follow `base`.
    pub async fn walk(&mut self, base: &[u64]) -> Result<Vec<(Vec<u64>, SnmpValue)>, String> {
        let mut rows = Vec::new();
        let mut cursor = base.to_vec();
        loop {
            let start = oid(&cursor)?;
            let pdu = timeout(TIMEOUT, self.session.getbulk(&[&start], 0, BULK_ROWS))
                .await
                .map_err(|_| "SNMP: máy in không trả lời".to_string())?
                .map_err(|e| format!("SNMP: {e:?}"))?;
            let mut advanced = false;
            for (name, value) in pdu.varbinds {
                let name = arcs(&name);
                if !name.starts_with(base) || matches!(value, Value::EndOfMibView) {
                    return Ok(rows);
                }
                rows.push((name[base.len()..].to_vec(), own(value)));
                cursor = name;
                advanced = true;
            }
            if !advanced {
                return Ok(rows);
            }
        }
    }
}
