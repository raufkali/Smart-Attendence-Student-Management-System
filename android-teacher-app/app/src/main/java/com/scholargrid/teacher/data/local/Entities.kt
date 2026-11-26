package com.scholargrid.teacher.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "teacher_config")
data class TeacherConfigEntity(
    @PrimaryKey val id: Int = 1,
    val serverBaseUrl: String = "http://192.168.1.100:3000",
    val deviceId: String = "",
    val authToken: String = "",
    val teacherId: Long = 0,
    val teacherName: String = "",
    val employeeId: String = "",
    val department: String = "",
    val retentionDays: Int = 30,
    val lastSyncAt: String = ""
)

@Entity(tableName = "timetable_sessions")
data class TimetableSessionEntity(
    @PrimaryKey val id: Long,
    val dayOfWeek: String,
    val startTime: String,
    val endTime: String,
    val subjectId: Long,
    val courseCode: String,
    val courseName: String,
    val className: String,
    val semester: String,
    val section: String,
    val room: String,
    val isSubstitution: Boolean = false
)

@Entity(tableName = "students")
data class StudentEntity(
    @PrimaryKey val id: Long,
    val studentCode: String,
    val fullName: String,
    val className: String,
    val semester: String,
    val section: String,
    val photoUrl: String = ""
)

@Entity(tableName = "attendance_sessions")
data class AttendanceSessionDraftEntity(
    @PrimaryKey val clientUuid: String,
    val timetableSessionId: Long,
    val sessionDate: String,
    val courseCode: String,
    val className: String,
    val section: String,
    val notes: String = "",
    val syncStatus: String = "DRAFT", // DRAFT | PENDING_SYNC | SYNCED | CONFLICT | ERROR
    val createdAt: String,
    val syncedAt: String? = null,
    val lastError: String? = null
)

@Entity(tableName = "attendance_records")
data class AttendanceRecordEntity(
    @PrimaryKey val clientUuid: String,
    val sessionClientUuid: String,
    val studentId: Long,
    val status: String, // present | absent | late | excused
    val remarks: String = "",
    val markedAt: String
)

@Entity(tableName = "sync_logs")
data class SyncLogEntity(
    @PrimaryKey val syncUuid: String,
    val timestamp: String,
    val payloadCount: Int,
    val acceptedCount: Int,
    val conflictCount: Int,
    val status: String,
    val details: String
)
