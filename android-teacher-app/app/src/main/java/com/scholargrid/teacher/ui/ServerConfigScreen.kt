package com.scholargrid.teacher.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.scholargrid.teacher.data.local.TeacherConfigEntity

@Composable
fun ServerConfigScreen(
    config: TeacherConfigEntity?,
    statusMessage: String,
    onTestConnection: (String) -> Unit,
    onPairWithCode: (String, String) -> Unit,
    onLoginTeacher: (String, String, String) -> Unit,
    onUpdateRetention: (Int) -> Unit,
    onBack: () -> Unit
) {
    var serverUrl by remember(config) { mutableStateOf(config?.serverBaseUrl ?: "http://192.168.1.100:3000") }
    var pairingCode by remember { mutableStateOf("") }
    var employeeId by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var retentionDays by remember(config) { mutableStateOf((config?.retentionDays ?: 30).toString()) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Local Server & Device Pairing", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            TextButton(onClick = onBack) { Text("Done") }
        }

        OutlinedTextField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = { Text("Administration PC URL (e.g. http://192.168.1.100:3000)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedButton(onClick = { onTestConnection(serverUrl) }) {
            Text("Test Connection")
        }

        HorizontalDivider()
        Text("Option A: Pair with 6-Digit Admin Code", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = pairingCode,
            onValueChange = { pairingCode = it },
            label = { Text("6-Digit Pairing Code") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        Button(onClick = { onPairWithCode(serverUrl, pairingCode) }) {
            Text("Pair Device")
        }

        HorizontalDivider()
        Text("Option B: Teacher Employee Sign-In", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = employeeId,
            onValueChange = { employeeId = it },
            label = { Text("Employee ID (e.g. EMP-101)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        Button(onClick = { onLoginTeacher(serverUrl, employeeId, password) }) {
            Text("Sign In & Sync Roster")
        }

        HorizontalDivider()
        OutlinedTextField(
            value = retentionDays,
            onValueChange = { retentionDays = it },
            label = { Text("Synced Local Copy Retention (Days)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        OutlinedButton(onClick = {
            val days = retentionDays.toIntOrNull()?.coerceIn(1, 365) ?: 30
            onUpdateRetention(days)
        }) {
            Text("Save Retention Setting")
        }

        if (statusMessage.isNotBlank()) {
            Text(statusMessage, color = MaterialTheme.colorScheme.primary)
        }
    }
}
