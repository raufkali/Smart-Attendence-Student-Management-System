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
import com.scholargrid.teacher.data.local.StudentEntity
import com.scholargrid.teacher.data.local.TimetableSessionEntity

@Composable
fun AttendanceMarkingScreen(
    session: TimetableSessionEntity,
    students: List<StudentEntity>,
    onBack: () -> Unit,
    onSaveDraft: (Map<Long, String>, String) -> Unit,
    onSubmitForSync: (Map<Long, String>, String) -> Unit
) {
    var search by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var showConfirm by remember { mutableStateOf(false) }

    val statuses = remember(students) {
        mutableStateMapOf<Long, String>().apply {
            students.forEach { put(it.id, "present") }
        }
    }

    val filtered = students.filter {
        search.isBlank() ||
            it.fullName.contains(search, ignoreCase = true) ||
            it.studentCode.contains(search, ignoreCase = true)
    }

    val presentCount = statuses.values.count { it == "present" }
    val absentCount = statuses.values.count { it == "absent" }
    val lateCount = statuses.values.count { it == "late" }
    val excusedCount = statuses.values.count { it == "excused" }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("${session.courseCode} • ${session.className} ${session.section}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("${session.startTime}–${session.endTime} • ${session.room}", style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onBack) { Text("Back") }
        }

        Spacer(Modifier.height(8.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("P: $presentCount  A: $absentCount  L: $lateCount  E: $excusedCount", fontWeight = FontWeight.Medium)
            FilledTonalButton(onClick = {
                students.forEach { statuses[it.id] = "present" }
            }) {
                Text("Mark All Present")
            }
        }

        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            label = { Text("Search student name or ID") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(Modifier.height(8.dp))

        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(filtered, key = { it.id }) { student ->
                val current = statuses[student.id] ?: "present"
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("${student.fullName} (${student.studentCode})", fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("present" to "Present", "absent" to "Absent", "late" to "Late", "excused" to "Excused").forEach { (key, label) ->
                                FilterChip(
                                    selected = current == key,
                                    onClick = { statuses[student.id] = key },
                                    label = { Text(label) }
                                )
                            }
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = notes,
            onValueChange = { notes = it },
            label = { Text("Session notes (optional)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { onSaveDraft(statuses.toMap(), notes) },
                modifier = Modifier.weight(1f)
            ) {
                Text("Save Offline Draft")
            }
            Button(
                onClick = { showConfirm = true },
                modifier = Modifier.weight(1f)
            ) {
                Text("Submit & Sync")
            }
        }
    }

    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("Confirm Attendance Submission") },
            text = {
                Text("Present: $presentCount, Absent: $absentCount, Late: $lateCount, Excused: $excusedCount. Stored safely on device until server confirms commit.")
            },
            confirmButton = {
                Button(onClick = {
                    showConfirm = false
                    onSubmitForSync(statuses.toMap(), notes)
                }) {
                    Text("Confirm")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirm = false }) { Text("Cancel") }
            }
        )
    }
}
