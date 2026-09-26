package com.chetan.connectsuite.probe

import com.chetan.connectsuite.probe.StorageQuotaReading.Staging
import com.chetan.connectsuite.probe.StorageQuotaReading.Value
import com.chetan.connectsuite.sync.v2.ShareStaging
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

/**
 * The storage-quota probe's pure rules: it creates nothing, follows no link, and its one log line
 * carries numbers, a timestamp and exception classes — never a path, a name or a message.
 */
class StorageQuotaReadingTest {

    private fun tmp(): File = Files.createTempDirectory("sqp").toFile()

    @Test fun `an absent staging folder is reported ABSENT and is NOT created`() {
        val cache = tmp()
        val dir = File(cache, ShareStaging.DIR_NAME)
        assertEquals(StorageQuotaReading.Staged(Staging.ABSENT, 0, 0), StorageQuotaReading.staged(dir))
        assertFalse("the probe created the staging folder", dir.exists())
        // Control: the product's own accessor DOES create it — which is why the probe does not call it.
        val other = File(tmp(), ShareStaging.DIR_NAME)
        ShareStaging.stagingDir(other.parentFile!!)
        assertTrue("control: stagingDir creates the folder", other.isDirectory)
    }

    @Test fun `a present folder sums its top-level regular files only — no subfolders, no links followed`() {
        val dir = File(tmp(), ShareStaging.DIR_NAME).apply { mkdirs() }
        File(dir, "s-a.part").writeBytes(ByteArray(1000))
        File(dir, "s-b.bin").writeBytes(ByteArray(234))
        File(dir, "nested").mkdirs()
        File(File(dir, "nested"), "deep.bin").writeBytes(ByteArray(5000))
        val outside = File(tmp(), "outside.bin").apply { writeBytes(ByteArray(9000)) }
        Files.createSymbolicLink(File(dir, "s-c.bin").toPath(), outside.toPath())
        assertEquals(StorageQuotaReading.Staged(Staging.PRESENT, 1234, 2), StorageQuotaReading.staged(dir))
    }

    @Test fun `a link or a file where the folder should be is REFUSED and nothing behind it is read`() {
        val real = tmp().apply { File(this, "x.bin").writeBytes(ByteArray(777)) }
        val link = File(tmp(), ShareStaging.DIR_NAME)
        Files.createSymbolicLink(link.toPath(), real.toPath())
        assertEquals(StorageQuotaReading.Staged(Staging.REFUSED, 0, 0), StorageQuotaReading.staged(link))
        val file = File(tmp(), ShareStaging.DIR_NAME).apply { writeBytes(ByteArray(10)) }
        assertEquals(Staging.REFUSED, StorageQuotaReading.staged(file).state)
    }

    @Test fun `a failure keeps its exception class and never its message`() {
        val v = StorageQuotaReading.read { throw IOException("/data/user/0/secret/path.bin") }
        assertEquals(Value.Failed("java.io.IOException"), v)
        assertEquals(Value.Bytes(42), StorageQuotaReading.read { 42 })
    }

    @Test fun `the line is numbers, booleans, a staging state and exception classes — no path, no message`() {
        val line = StorageQuotaReading.line(
            readAtMs = 1_790_000_000_000,
            volumeIsDefault = Value.Bytes(1),
            quotaBytes = StorageQuotaReading.read { throw IOException("/data/user/0/com.chetan.connectsuite.debug/cache") },
            usableBytes = Value.Bytes(22_089_035_776),
            totalBytes = Value.Bytes(489_993_273_344),
            allocatableBytesNotFreeSpace = Value.Bytes(25_000_000_000),
            ownCacheBytes = Value.Bytes(634_880),
            staged = StorageQuotaReading.Staged(Staging.ABSENT, 0, 0),
        )
        assertEquals(
            "readAtMs=1790000000000 volumeIsDefault=true quotaBytes=FAILED:java.io.IOException usableBytes=22089035776 " +
                "totalBytes=489993273344 allocatableBytesNotFreeSpace=25000000000 ownCacheBytes=634880 " +
                "stagingDir=ABSENT stagedBytes=0 stagedFiles=0",
            line,
        )
        assertFalse("no path reaches the line", line.contains('/'))
        val shape = Regex("^[A-Za-z]+=(\\d+|true|false|ABSENT|PRESENT|REFUSED|FAILED:[A-Za-z0-9_.$]+)$")
        line.split(' ').forEach { assertTrue("unexpected field shape: $it", shape.matches(it)) }
    }
}
