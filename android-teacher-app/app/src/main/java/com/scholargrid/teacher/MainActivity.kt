package com.scholargrid.teacher

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.lifecycle.lifecycleScope
import com.scholargrid.teacher.data.local.*
import com.scholargrid.teacher.data.remote.*
import com.scholargrid.teacher.sync.AttendanceSyncWorker
import com.scholargrid.teacher.ui.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dao = AppDatabase.getInstance(applicationContext).teacherDao()

        setContent {
            MaterialTheme {
                val config by dao.observeConfig().collectAsState(initial = null)
                val timetable by dao.observeTimetable().collectAsState(initial = emptyList())
                val sessions by dao.observeSessions().collectAsState(initial = emptyList())
                val syncLogs by dao.observeSyncLogs().collectAsState(initial = emptyList())

                var activeScreen by remember { mutableStateOf("dashboard") }
                var selectedSession by remember { mutableStateOf<TimetableSessionEntity?>(null) }
                var statusMessage by remember { mutableStateOf("") }
                var isOnline by remember { mutableStateOf(false) }
                var isSyncing by remember { mutableStateOf(false) }

                LaunchedEffect(config?.serverBaseUrl) {
                    val url = config?.serverBaseUrl
                    if (!url.isNullOrBlank()) {
                        isOnline = runCatching { LocalApiService.create(url).health().ok }.getOrDefault(false)
                    }
                }

                when (activeScreen) {
                    "settings" -> ServerConfigScreen(
                        config = config,
                        statusMessage = statusMessage,
                        onTestConnection = { url ->
                            lifecycleScope.launch {
                                statusMessage = runCatching {
                                    val h = LocalApiService.create(url).health()
                                    isOnline = h.ok
                                    "Connected to ${h.database ?: "local server"}"
                                }.getOrElse {
                                    isOnline = false
                                    "Connection failed: ${it.message}"
                                }
                            }
                        },
                        onPairWithCode = { url, code ->
                            lifecycleScope.launch {
                                statusMessage = runCatching {
                                    val devId = config?.deviceId?.ifBlank { UUID.randomUUID().toString() } ?: UUID.randomUUID().toString()
                                    val res = LocalApiService.create(url).pairDevice(
                                        PairRequest(code = code, device_id = devId, device_name = Build.MODEL ?: "Android Device")
                                    )
                                    dao.saveConfig(
                                        TeacherConfigEntity(
                                            serverBaseUrl = url,
                                            deviceId = devId,
                                            authToken = res.token,
                                            teacherId = res.teacher.id,
                                            teacherName = res.teacher.fullName,
                                            employeeId = res.teacher.employeeId,
                                            department = res.teacher.department
                                        )
                                    )
                                    AttendanceSyncWorker.enqueueImmediate(applicationContext)
                                    isOnline = true
                                    activeScreen = "dashboard"
                                    "Paired successfully"
                                }.getOrElse { "Pairing failed: ${it.message}" }
                            }
                        },
                        onLoginTeacher = { url, empId, pass ->
                            lifecycleScope.launch {
                                statusMessage = runCatching {
                                    val devId = config?.deviceId?.ifBlank { UUID.randomUUID().toString() } ?: UUID.randomUUID().toString()
                                    val res = LocalApiService.create(url).loginTeacher(
                                        MobileLoginRequest(empId, pass, devId, Build.MODEL ?: "Android Device")
                                    )
                                    dao.saveConfig(
                                        TeacherConfigEntity(
                                            serverBaseUrl = url,
                                            deviceId = devId,
                                            authToken = res.token,
                                            teacherId = res.teacher.id,
                                            teacherName = res.teacher.fullName,
                                            employeeId = res.teacher.employeeId,
                                            department = res.teacher.department
                                        )
                                    )
                                    AttendanceSyncWorker.enqueueImmediate(applicationContext)
                                    isOnline = true
                                    activeScreen = "dashboard"
                                    "Signed in"
                                }.getOrElse { "Sign-in failed: ${it.message}" }
                            }
                        },
                        onUpdateRetention = { days ->
                            lifecycleScope.launch {
                                val current = dao.getConfig() ?: TeacherConfigEntity()
                                dao.saveConfig(current.copy(retentionDays = days))
                                statusMessage = "Retention set to $days days"
                            }
                        },
                        onBack = { activeScreen = "dashboard" }
                    )

                    "mark" -> {
                        val sess = selectedSession
                        if (sess != null) {
                            val cohortStudents by dao.observeCohortStudents(sess.className, sess.section)
                                .collectAsState(initial = emptyList())
                            AttendanceMarkingScreen(
                                session = sess,
                                students = cohortStudents,
                                onBack = { activeScreen = "dashboard" },
                                onSaveDraft = { map, notes ->
                                    lifecycleScope.launch {
                                        val nowIso = Instant.now().toString()
                                        val sessionUuid = UUID.randomUUID().toString()
                                        val records = map.map { (stuId, st) ->
                                            AttendanceRecordEntity(
                                                clientUuid = UUID.randomUUID().toString(),
                                                sessionClientUuid = sessionUuid,
                                                studentId = stuId,
                                                status = st,
                                                markedAt = nowIso
                                            )
                                        }
                                        dao.saveDraftOrQueue(
                                            AttendanceSessionDraftEntity(
                                                clientUuid = sessionUuid,
                                                timetableSessionId = sess.id,
                                                sessionDate = LocalDate.now().toString(),
                                                courseCode = sess.courseCode,
                                                className = sess.className,
                                                section = sess.section,
                                                notes = notes,
                                                syncStatus = "DRAFT",
                                                createdAt = nowIso
                                            ),
                                            records
                                        )
                                        activeScreen = "dashboard"
                                    }
                                },
                                onSubmitForSync = { map, notes ->
                                    lifecycleScope.launch {
                                        val nowIso = Instant.now().toString()
                                        val sessionUuid = UUID.randomUUID().toString()
                                        val records = map.map { (stuId, st) ->
                                            AttendanceRecordEntity(
                                                clientUuid = UUID.randomUUID().toString(),
                                                sessionClientUuid = sessionUuid,
                                                studentId = stuId,
                                                status = st,
                                                markedAt = nowIso
                                            )
                                        }
                                        dao.saveDraftOrQueue(
                                            AttendanceSessionDraftEntity(
                                                clientUuid = sessionUuid,
                                                timetableSessionId = sess.id,
                                                sessionDate = LocalDate.now().toString(),
                                                courseCode = sess.courseCode,
                                                className = sess.className,
                                                section = sess.section,
                                                notes = notes,
                                                syncStatus = "PENDING_SYNC",
                                                createdAt = nowIso
                                            ),
                                            records
                                        )
                                        AttendanceSyncWorker.enqueueImmediate(applicationContext)
                                        activeScreen = "dashboard"
                                    }
                                }
                            )
                        }
                    }

                    else -> TeacherDashboardScreen(
                        config = config,
                        timetable = timetable,
                        sessions = sessions,
                        syncLogs = syncLogs,
                        isSyncing = isSyncing,
                        isOnline = isOnline,
                        onSyncNow = {
                            isSyncing = true
                            AttendanceSyncWorker.enqueueImmediate(applicationContext)
                            isSyncing = false
                        },
                        onOpenSession = { item ->
                            selectedSession = item
                            activeScreen = "mark"
                        },
                        onOpenSettings = { activeScreen = "settings" }
                    )
                }
            }
        }
    }
}
