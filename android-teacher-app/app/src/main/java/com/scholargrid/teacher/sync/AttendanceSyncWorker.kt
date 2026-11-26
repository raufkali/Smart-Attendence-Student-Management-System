package com.scholargrid.teacher.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.scholargrid.teacher.data.local.*
import com.scholargrid.teacher.data.remote.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.TimeUnit

class AttendanceSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val dao = AppDatabase.getInstance(applicationContext).teacherDao()
        val config = dao.getConfig() ?: return Result.success()
        if (config.authToken.isBlank() || config.serverBaseUrl.isBlank()) {
            return Result.success()
        }

        val api = LocalApiService.create(config.serverBaseUrl)
        val bearer = "Bearer ${config.authToken}"
        val nowIso = Instant.now().toString()

        return try {
            // 1. Push any pending offline attendance sessions with idempotent UUIDs
            val pending = dao.getPendingSessions()
            if (pending.isNotEmpty()) {
                val payloadSessions = pending.map { sess ->
                    val recs = dao.getRecordsForSession(sess.clientUuid).map { r ->
                        SyncRecordDto(
                            client_uuid = r.clientUuid,
                            student_id = r.studentId,
                            status = r.status,
                            remarks = r.remarks,
                            marked_at = r.markedAt
                        )
                    }
                    SyncSessionDto(
                        client_uuid = sess.clientUuid,
                        timetable_session_id = sess.timetableSessionId,
                        session_date = sess.sessionDate,
                        notes = sess.notes,
                        records = recs
                    )
                }

                val syncUuid = UUID.randomUUID().toString()
                val response = api.syncAttendance(
                    bearer = bearer,
                    body = SyncAttendanceRequest(
                        sync_uuid = syncUuid,
                        device_id = config.deviceId,
                        sessions = payloadSessions
                    )
                )

                // CRITICAL: Only mark synced after explicit server DB commit acknowledgement
                val accepted = response.acceptedSessionUuids?.toSet() ?: emptySet()
                for (uuid in accepted) {
                    dao.markSessionSynced(uuid, nowIso)
                }
                response.conflictDetails?.forEach { conflict ->
                    dao.markSessionConflict(conflict.client_uuid, conflict.reason)
                }

                dao.insertSyncLog(
                    SyncLogEntity(
                        syncUuid = syncUuid,
                        timestamp = nowIso,
                        payloadCount = pending.size,
                        acceptedCount = response.acceptedCount,
                        conflictCount = response.conflictCount,
                        status = if (response.conflictCount > 0) "PARTIAL_CONFLICT" else "SUCCESS",
                        details = "Accepted ${response.acceptedCount}, Duplicates ${response.duplicateCount}, Conflicts ${response.conflictCount}"
                    )
                )

                if (response.acceptedCount > 0) {
                    showNotification(
                        applicationContext,
                        "Attendance Synced",
                        "${response.acceptedCount} session(s) committed to central institution server."
                    )
                }
            }

            // 2. Pull latest assigned timetable & student roster
            val pulled = api.pullTeacherData(bearer)
            dao.clearTimetable()
            dao.insertTimetable(
                pulled.timetable.map {
                    TimetableSessionEntity(
                        id = it.id,
                        dayOfWeek = it.day_of_week,
                        startTime = it.start_time,
                        endTime = it.end_time,
                        subjectId = it.subject_id,
                        courseCode = it.course_code,
                        courseName = it.course_name,
                        className = it.class_name,
                        semester = it.semester,
                        section = it.section,
                        room = it.room
                    )
                }
            )
            dao.clearStudents()
            dao.insertStudents(
                pulled.students.map {
                    StudentEntity(
                        id = it.id,
                        studentCode = it.student_code,
                        fullName = it.full_name,
                        className = it.class_name,
                        semester = it.semester,
                        section = it.section,
                        photoUrl = it.photo_url ?: ""
                    )
                }
            )

            // 3. Apply configurable local retention policy on already-synced copies
            val cutoff = Instant.now().minus(config.retentionDays.toLong(), ChronoUnit.DAYS).toString()
            dao.purgeOldSyncedSessions(cutoff)
            dao.saveConfig(config.copy(lastSyncAt = nowIso))

            Result.success()
        } catch (ex: Exception) {
            dao.getPendingSessions().forEach { s ->
                dao.markSessionError(s.clientUuid, ex.message ?: "Local server unreachable")
            }
            Result.retry()
        }
    }

    private fun showNotification(context: Context, title: String, message: String) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "scholargrid_sync"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Attendance Sync", NotificationManager.IMPORTANCE_DEFAULT)
            manager.createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(message)
            .setAutoCancel(true)
            .build()
        manager.notify(title.hashCode(), notification)
    }

    companion object {
        private const val UNIQUE_PERIODIC = "scholargrid_periodic_sync"
        private const val UNIQUE_IMMEDIATE = "scholargrid_immediate_sync"

        fun schedulePeriodic(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<AttendanceSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun enqueueImmediate(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<AttendanceSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_IMMEDIATE,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }
    }
}
