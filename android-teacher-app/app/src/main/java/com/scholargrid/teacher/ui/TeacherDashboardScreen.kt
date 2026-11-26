package com.scholargrid.teacher.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.scholargrid.teacher.data.local.*
import java.time.LocalDate

@Composable
fun TeacherDashboardScreen(
    config: TeacherConfigEntity?,
    timetable: List<TimetableSessionEntity>,
    sessions: List<AttendanceSessionDraftEntity>,
    syncLogs: List<SyncLogEntity>,
    isSyncing: Boolean,
    isOnline: Boolean,
    onSyncNow: () -> Unit,
    onOpenSession: (TimetableSessionEntity) -> Unit,
    onOpenSettings: () -> Unit
) {
    val todayDay = LocalDate.now().dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }
    val todayClasses = timetable.filter { it.dayOfWeek.equals(todayDay, ignoreCase = true) }
    val pendingCount = sessions.count { it.syncStatus == "PENDING_SYNC" || it.syncStatus == "ERROR" }
    val conflictCount = sessions.count { it.syncStatus == "CONFLICT" }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = config?.teacherName?.ifBlank { "Teacher Not Paired" } ?: "Teacher Not Paired",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${config?.employeeId ?: ""} • ${if (isOnline) "Local Server Connected" else "Offline Mode"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isOnline) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenSettings) { Text("Server") }
                Button(onClick = onSyncNow, enabled = !isSyncing) {
                    Text(if (isSyncing) "Syncing..." else "Sync Now")
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        Card(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text("Today's Classes", style = MaterialTheme.typography.labelSmall)
                    Text("${todayClasses.size}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Column {
                    Text("Pending Sync", style = MaterialTheme.typography.labelSmall)
                    Text("$pendingCount", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Column {
                    Text("Conflicts", style = MaterialTheme.typography.labelSmall)
                    Text("$conflictCount", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Column {
                    Text("Submitted", style = MaterialTheme.typography.labelSmall)
                    Text("${sessions.count { it.syncStatus == "SYNCED" }}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Text("Today's Schedule ($todayDay)", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
            items(todayClasses.ifEmpty { timetable }) { item ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${item.courseCode} — ${item.courseName}", fontWeight = FontWeight.SemiBold)
                            Text(
                                "${item.dayOfWeek} ${item.startTime}–${item.endTime} • ${item.className} ${item.section} • ${item.room}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Button(onClick = { onOpenSession(item) }) {
                            Text("Mark")
                        }
                    }
                }
            }

            if (syncLogs.isNotEmpty()) {
                item {
                    Spacer(Modifier.height(8.dp))
                    Text("Recent Sync Activity", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                }
                items(syncLogs.take(5)) { log ->
                    Text(
                        "${log.status} • ${log.details} (${log.timestamp.take(19)})",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }
    }
}
