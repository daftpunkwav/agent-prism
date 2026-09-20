/**
 * @file win-sandbox-helper
 * @description Materialized PowerShell helper that spawns commands under a Windows write-restricted token.
 *
 * Responsibilities:
 * - Own the helper script source (PowerShell driver + embedded C# P/Invoke body)
 * - Keep the C# compatible with the PowerShell 5.1 Add-Type compiler (C# 5)
 *
 * Enforcement model: the child runs with a restricted clone of the current
 * process token (WRITE_RESTRICTED) so write access requires a restricting SID
 * to appear in the target DACL. A capability SID derived deterministically from
 * the writable root (stable across spawns, so grants are idempotent) is granted
 * an inheritable allow-write ACE on that root and its existing descendants —
 * reparse points are never granted nor recursed into, so a junction planted in
 * the root cannot leak ACEs onto its target — and nothing else. Reads and
 * network stay unaffected while every other write is denied by the OS. Any
 * setup failure prints the fail-closed sentinel to stderr and exits 3; it never
 * falls back to an unsandboxed spawn.
 */

/** Marker printed (with a per-spawn nonce) when sandbox setup fails; the host maps it to a setup error. */
export const SANDBOX_SETUP_SENTINEL = "__SANDBOX_SETUP_FAILED__:";

/** The helper script: params come from the launcher transform, C# does the Win32 work. */
export const WIN_SANDBOX_HELPER_PS1 = String.raw`
# win-sandbox helper: spawn a command under a write-restricted token.
#
# Writes are denied everywhere except the declared roots (read access and
# network stay unaffected). Setup failures print the sentinel line to stderr
# and exit 3 so the host can fail closed instead of running unsandboxed.
param(
  [Parameter(Mandatory = $true)][string]$CommandJson,
  [Parameter(Mandatory = $true)][string]$Cwd,
  [Parameter(Mandatory = $true)][string]$WritableRootsJson,
  [Parameter(Mandatory = $true)][string]$Nonce
)

$ErrorActionPreference = "Stop"
$SENTINEL = "__SANDBOX_SETUP_FAILED__:"

function Fail([string]$Reason) {
  [Console]::Error.WriteLine($SENTINEL + $Nonce + ":" + $Reason)
  exit 3
}

try { $argv = @((ConvertFrom-Json -InputObject $CommandJson)) } catch { Fail "command payload is not valid JSON" }
try { $roots = @((ConvertFrom-Json -InputObject $WritableRootsJson)) } catch { Fail "writable roots payload is not valid JSON" }
if ($argv.Count -lt 1 -or -not $argv[0]) { Fail "empty command" }
if ($roots.Count -lt 1) { Fail "no writable roots" }
if (-not (Test-Path -LiteralPath $Cwd -PathType Container)) { Fail "cwd does not exist" }

# Compile once, cache the assembly beside this script. -OutputAssembly does not
# always import the types into the session, so the type is checked explicitly
# and the cached assembly is loaded when still missing. Concurrent first spawns:
# compile to a PID-unique temp name, then rename into place; the artifacts are
# identical, so a lost rename race is benign. Transient Add-Type/Move failures
# (file swapped mid-read) are retried; the cache is never deleted here — source
# changes invalidate it on the host side.
$dllPath = Join-Path $PSScriptRoot "SandboxSpawn.dll"
$csPath = Join-Path $PSScriptRoot "SandboxSpawn.cs"
$csSource = [System.IO.File]::ReadAllText($csPath)

for ($attempt = 0; $attempt -lt 4 -and -not ("AgentPrism.Sandbox.SandboxSpawn" -as [type]); $attempt += 1) {
  try {
    if (Test-Path -LiteralPath $dllPath) {
      Add-Type -Path $dllPath
    } else {
      $tmpDll = "$dllPath.$PID.tmp"
      Add-Type -TypeDefinition $csSource -OutputAssembly $tmpDll
      Move-Item -LiteralPath $tmpDll -Destination $dllPath -Force
    }
  } catch {
    Start-Sleep -Milliseconds (200 * ($attempt + 1))
  }
}
if (-not ("AgentPrism.Sandbox.SandboxSpawn" -as [type])) {
  Fail "cannot load sandbox helper after retries; delete the sandbox cache directory and retry"
}

try {
  $code = [AgentPrism.Sandbox.SandboxSpawn]::Spawn([string[]]$argv, $Cwd, [string[]]$roots)
  exit $code
} catch {
  # PowerShell wraps .NET throws in MethodInvocationException: unwrap to the Win32Exception for the error code.
  $e = $_.Exception
  if ($e -isnot [System.ComponentModel.Win32Exception] -and $e.InnerException) { $e = $e.InnerException }
  $win32Code = ""
  if ($e -is [System.ComponentModel.Win32Exception]) { $win32Code = " (Win32 error " + $e.NativeErrorCode + ")" }
  Fail ("sandbox spawn failed: " + $e.Message + $win32Code)
}
`;

/** The C# body (C# 5 syntax: the PowerShell 5.1 Add-Type compiler is the ceiling). */
export const WIN_SANDBOX_HELPER_CS = String.raw`
// SandboxSpawn: spawn a child under a write-restricted clone of the current
// process token. Write access requires a restricting SID in the target DACL,
// so granting an inheritable allow-write ACE to a deterministic capability SID
// on the writable root's real tree (reparse points skipped) confines all child
// writes to the workspace. Reads and network stay unaffected; setup failures
// throw.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace AgentPrism.Sandbox
{
    public static class SandboxSpawn
    {
        private const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
        private const uint TOKEN_DUPLICATE = 0x0002;
        private const uint TOKEN_QUERY = 0x0008;
        private const uint TOKEN_ADJUST_DEFAULT = 0x0080;

        private const uint DISABLE_MAX_PRIVILEGE = 0x00000001;
        private const uint LUA_TOKEN = 0x00000004;
        private const uint WRITE_RESTRICTED = 0x00000008;

        private const uint GENERIC_ALL = 0x10000000;

        private const int TokenDefaultDacl = 6;
        private const int TokenGroups = 2;
        private const uint SE_GROUP_LOGON_ATTRIBUTE = 0xC0000000;

        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_UNICODE_ENV = 0x00000400;
        private const uint CREATE_NO_WINDOW = 0x08000000;

        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        private const int STD_INPUT_HANDLE = -10;
        private const int STD_OUTPUT_HANDLE = -11;
        private const int STD_ERROR_HANDLE = -12;

        public static int Spawn(string[] argv, string cwd, string[] writableRoots)
        {
            IntPtr processToken = IntPtr.Zero;
            IntPtr restrictedToken = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            IntPtr envBlock = IntPtr.Zero;
            IntPtr logonSid = IntPtr.Zero;
            IntPtr everyoneSid = IntPtr.Zero;
            IntPtr capabilityNative = IntPtr.Zero;
            try
            {
                // The restricted clone derives its rights from this handle: ASSIGN_PRIMARY
                // is required to spawn from it, ADJUST_DEFAULT for the DACL rewrite below.
                if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, out processToken))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot open the process token");

                // One deterministic capability SID for the writable root (the launcher
                // refuses multi-root requests, so root 0 is the only root): repeated
                // spawns of the same workspace reuse it, so the DACL grant is
                // idempotent (no ACE accumulation) and concurrent grants converge on
                // the same value.
                SecurityIdentifier capabilitySid = CapabilitySidForRoot(writableRoots[0]);
                GrantWorkspaceWrite(writableRoots[0], capabilitySid);

                // The child's TEMP/TMP live inside the writable root: the redirected
                // directory inherits the capability ACE, so transient files keep working.
                string tempDir = Path.Combine(writableRoots[0], ".sandbox-tmp");
                Directory.CreateDirectory(tempDir);

                // Restricting SIDs gate every write: the check passes only where the
                // target DACL grants one of them. The logon session SID (not the user
                // SID) and the capability SID cover objects the child creates and the
                // workspace; Everyone is included deliberately, which also keeps
                // locations whose DACL grants World writable — that exposure is a
                // documented boundary, not a containment guarantee.
                logonSid = QueryLogonSid(processToken);
                everyoneSid = SidToNative(new SecurityIdentifier(WellKnownSidType.WorldSid, null));
                capabilityNative = SidToNative(capabilitySid);

                restrictedToken = CreateWriteRestrictedToken(processToken, logonSid, everyoneSid, capabilityNative);
                SetTokenDefaultDacl(restrictedToken, logonSid, everyoneSid, capabilityNative);

                envBlock = BuildEnvironmentBlock(tempDir);
                return SpawnRestricted(argv, cwd, restrictedToken, envBlock, out job);
            }
            finally
            {
                if (envBlock != IntPtr.Zero) Marshal.FreeHGlobal(envBlock);
                if (job != IntPtr.Zero) CloseHandle(job);
                if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
                if (processToken != IntPtr.Zero) CloseHandle(processToken);
                if (logonSid != IntPtr.Zero) Marshal.FreeHGlobal(logonSid);
                if (everyoneSid != IntPtr.Zero) Marshal.FreeHGlobal(everyoneSid);
                if (capabilityNative != IntPtr.Zero) Marshal.FreeHGlobal(capabilityNative);
            }
        }

        private static IntPtr CreateWriteRestrictedToken(IntPtr baseToken, IntPtr logonSid, IntPtr everyoneSid, IntPtr capabilitySid)
        {
            SID_AND_ATTRIBUTES[] restrict = new SID_AND_ATTRIBUTES[3];
            restrict[0].Sid = logonSid;
            restrict[0].Attributes = 0;
            restrict[1].Sid = everyoneSid;
            restrict[1].Attributes = 0;
            restrict[2].Sid = capabilitySid;
            restrict[2].Attributes = 0;
            int entrySize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            IntPtr arrayPtr = Marshal.AllocHGlobal(entrySize * restrict.Length);
            try
            {
                for (int i = 0; i < restrict.Length; i++)
                {
                    IntPtr entry = new IntPtr(arrayPtr.ToInt64() + i * entrySize);
                    Marshal.StructureToPtr(restrict[i], entry, false);
                }
                // A restricted clone of our own primary token needs no elevation.
                IntPtr restrictedToken;
                if (!CreateRestrictedToken(
                        baseToken,
                        DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
                        0, IntPtr.Zero,
                        0, IntPtr.Zero,
                        (uint)restrict.Length, arrayPtr,
                        out restrictedToken))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot create the write-restricted token");
                return restrictedToken;
            }
            finally
            {
                Marshal.FreeHGlobal(arrayPtr);
            }
        }

        // Objects the child creates with a default descriptor must stay writable by
        // the child itself: grant everyone in the restricting set GENERIC_ALL there.
        private static void SetTokenDefaultDacl(IntPtr token, IntPtr logonSid, IntPtr everyoneSid, IntPtr capabilitySid)
        {
            RawAcl acl = new RawAcl(GenericAcl.AclRevision, 3);
            acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, (int)GENERIC_ALL, new SecurityIdentifier(capabilitySid), false, null));
            acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, (int)GENERIC_ALL, new SecurityIdentifier(everyoneSid), false, null));
            acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, (int)GENERIC_ALL, new SecurityIdentifier(logonSid), false, null));
            byte[] binary = new byte[acl.BinaryLength];
            acl.GetBinaryForm(binary, 0);
            IntPtr aclNative = Marshal.AllocHGlobal(binary.Length);
            try
            {
                Marshal.Copy(binary, 0, aclNative, binary.Length);
                TOKEN_DEFAULT_DACL dacl = new TOKEN_DEFAULT_DACL();
                dacl.DefaultDacl = aclNative;
                IntPtr structPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL)));
                try
                {
                    Marshal.StructureToPtr(dacl, structPtr, false);
                    if (!SetTokenInformation(token, TokenDefaultDacl, structPtr, (uint)Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL))))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot set the token default DACL");
                }
                finally
                {
                    Marshal.FreeHGlobal(structPtr);
                }
            }
            finally
            {
                Marshal.FreeHGlobal(aclNative);
            }
        }

        private static void GrantWorkspaceWrite(string root, SecurityIdentifier sid)
        {
            DirectoryInfo dir = new DirectoryInfo(root);
            if (!dir.Exists) throw new InvalidOperationException("writable root does not exist: " + root);
            FileSystemAccessRule rule = new FileSystemAccessRule(
                sid,
                FileSystemRights.Write | FileSystemRights.Synchronize,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow);
            // .NET's SetAccessControl never propagates a fresh inheritable ACE to
            // objects that already exist (only SetNamedSecurityInfo-style APIs do),
            // so the grant is applied to the root AND every existing descendant;
            // new children inherit from the root DACL. Already-granted entries are
            // skipped, which keeps repeated spawns cheap and idempotent.
            ApplyGrant(dir, rule);
        }

        private static void ApplyGrant(FileSystemInfo entry, FileSystemAccessRule rule)
        {
            // Reparse points (junctions, directory symlinks) are neither granted nor
            // recursed into: enumeration and the child's own path resolution both
            // follow the link, so "granting the descendants" of a link would write
            // ACEs onto its target's real files — outside the workspace. Skipping
            // keeps writes through such a link fail-closed (access denied), and the
            // link itself needs no grant to be read.
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) return;
            DirectoryInfo directory = entry as DirectoryInfo;
            if (directory != null)
            {
                if (!AlreadyGranted(directory, rule)) WriteGrant(directory, rule);
                // Failures on single entries (locked files) must not sink the grant:
                // those objects stay non-writable, which is fail-closed, not an escape.
                FileSystemInfo[] children;
                try
                {
                    children = directory.GetFileSystemInfos();
                }
                catch (IOException)
                {
                    return;
                }
                catch (UnauthorizedAccessException)
                {
                    return;
                }
                foreach (FileSystemInfo child in children) ApplyGrant(child, rule);
            }
            else
            {
                // Files cannot carry inheritable ACEs: a directory-shaped rule
                // would make AddAccessRule throw on the inheritanceFlags argument.
                FileSystemAccessRule fileRule = new FileSystemAccessRule(
                    rule.IdentityReference,
                    rule.FileSystemRights,
                    AccessControlType.Allow);
                if (!AlreadyGranted((FileInfo)entry, fileRule)) WriteGrant((FileInfo)entry, fileRule);
            }
        }

        private static bool AlreadyGranted(FileSystemInfo entry, FileSystemAccessRule rule)
        {
            try
            {
                AuthorizationRuleCollection existing = entry is DirectoryInfo
                    ? ((DirectoryInfo)entry).GetAccessControl(AccessControlSections.Access).GetAccessRules(true, false, typeof(SecurityIdentifier))
                    : ((FileInfo)entry).GetAccessControl(AccessControlSections.Access).GetAccessRules(true, false, typeof(SecurityIdentifier));
                foreach (FileSystemAccessRule current in existing)
                {
                    if (current.IdentityReference.Equals(rule.IdentityReference)
                        && current.AccessControlType == AccessControlType.Allow
                        && (current.FileSystemRights & rule.FileSystemRights) == rule.FileSystemRights)
                        return true;
                }
            }
            catch (UnauthorizedAccessException)
            {
                // Cannot read the DACL: fall through and attempt the write, which
                // reports its own failure.
            }
            return false;
        }

        private static void WriteGrant(DirectoryInfo directory, FileSystemAccessRule rule)
        {
            DirectorySecurity security = directory.GetAccessControl(AccessControlSections.Access);
            security.AddAccessRule(rule);
            directory.SetAccessControl(security);
        }

        private static void WriteGrant(FileInfo file, FileSystemAccessRule rule)
        {
            FileSecurity security = file.GetAccessControl(AccessControlSections.Access);
            security.AddAccessRule(rule);
            file.SetAccessControl(security);
        }

        // S-1-5-21-<a>-<b>-<c> derived from a stable hash of the lower-cased root
        // path: always well-formed and identical across spawns of the same
        // workspace. It is an identity for the DACL grant, not a secret — a
        // same-user process can recompute it, which is fine because writing the
        // ACE still requires ownership of the workspace DACL.
        private static SecurityIdentifier CapabilitySidForRoot(string root)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()));
                uint a = BitConverter.ToUInt32(hash, 0) & 0x7FFFFFFFu;
                uint b = BitConverter.ToUInt32(hash, 4) & 0x7FFFFFFFu;
                uint c = BitConverter.ToUInt32(hash, 8) & 0x7FFFFFFFu;
                return new SecurityIdentifier("S-1-5-21-" + a.ToString(System.Globalization.CultureInfo.InvariantCulture) + "-" + b.ToString(System.Globalization.CultureInfo.InvariantCulture) + "-" + c.ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
        }

        private static IntPtr QueryLogonSid(IntPtr token)
        {
            // Canonical extraction: scan TokenGroups for the entry flagged with
            // SE_GROUP_LOGON_ATTRIBUTE (the per-session logon SID no file DACL grants to).
            uint returnLength;
            GetTokenInformation(token, TokenGroups, IntPtr.Zero, 0, out returnLength);
            if (returnLength == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot size the token groups");
            IntPtr buffer = Marshal.AllocHGlobal((int)returnLength);
            try
            {
                if (!GetTokenInformation(token, TokenGroups, buffer, returnLength, out returnLength))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot query the token groups");
                // TOKEN_GROUPS has natural alignment: entries begin after GroupCount
                // at IntPtr.Size (padding precedes the first pointer on 64-bit).
                int count = Marshal.ReadInt32(buffer, 0);
                int entrySize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
                for (int i = 0; i < count; i++)
                {
                    IntPtr entry = new IntPtr(buffer.ToInt64() + IntPtr.Size + i * entrySize);
                    IntPtr sid = Marshal.ReadIntPtr(entry);
                    uint attributes = (uint)Marshal.ReadInt32(entry, IntPtr.Size);
                    if ((attributes & SE_GROUP_LOGON_ATTRIBUTE) != 0) return CopySidNative(sid);
                }
                throw new InvalidOperationException("token carries no logon SID");
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static IntPtr CopySidNative(IntPtr source)
        {
            uint length = GetLengthSid(source);
            IntPtr copy = Marshal.AllocHGlobal((int)length);
            if (!CopySid(length, copy, source)) throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot copy the logon SID");
            return copy;
        }

        private static IntPtr SidToNative(SecurityIdentifier sid)
        {
            byte[] bytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(bytes, 0);
            IntPtr native = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, native, bytes.Length);
            return native;
        }

        private static IntPtr BuildEnvironmentBlock(string tempDir)
        {
            List<string> entries = new List<string>();
            IDictionary variables = Environment.GetEnvironmentVariables();
            foreach (DictionaryEntry entry in variables)
            {
                string key = (string)entry.Key;
                if (string.Equals(key, "TEMP", StringComparison.OrdinalIgnoreCase)) continue;
                if (string.Equals(key, "TMP", StringComparison.OrdinalIgnoreCase)) continue;
                entries.Add(key + "=" + (string)entry.Value);
            }
            entries.Add("TEMP=" + tempDir);
            entries.Add("TMP=" + tempDir);
            entries.Sort(StringComparer.OrdinalIgnoreCase);
            StringBuilder builder = new StringBuilder();
            foreach (string entry in entries) builder.Append(entry).Append('\0');
            builder.Append('\0');
            IntPtr block = Marshal.AllocHGlobal(builder.Length * 2);
            Marshal.Copy(builder.ToString().ToCharArray(), 0, block, builder.Length);
            return block;
        }

        private static int SpawnRestricted(string[] argv, string cwd, IntPtr token, IntPtr envBlock, out IntPtr job)
        {
            string commandLine = BuildCommandLine(argv);

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(si);
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = GetStdHandle(unchecked((uint)STD_INPUT_HANDLE));
            si.hStdOutput = GetStdHandle(unchecked((uint)STD_OUTPUT_HANDLE));
            si.hStdError = GetStdHandle(unchecked((uint)STD_ERROR_HANDLE));
            PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot create the job object");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(limits)))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot configure the job object");

            // Inherit the helper's stdio pipes (captured by the host), start suspended
            // so the job assignment cannot race the first child exit, and stay
            // windowless: the helper owns no console, so a bare spawn would pop one.
            if (!CreateProcessAsUserW(
                    token, null, commandLine,
                    IntPtr.Zero, IntPtr.Zero, true,
                    CREATE_SUSPENDED | CREATE_UNICODE_ENV | CREATE_NO_WINDOW,
                    envBlock, cwd, ref si, out pi))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot create the sandboxed process");
            try
            {
                // Signature order is (hJob, hProcess).
                if (!AssignProcessToJobObject(job, pi.hProcess))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot assign the process to the job");
                if (ResumeThread(pi.hThread) == 0xFFFFFFFFu)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot resume the sandboxed process");
            }
            finally
            {
                CloseHandle(pi.hThread);
            }

            // Kill-on-close on the job: when the host kills this helper the whole
            // sandboxed tree dies with it (timeout and abort reuse this path).
            if (WaitForSingleObject(pi.hProcess, 0xFFFFFFFFu) != 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot wait for the sandboxed process");
            uint exitCode;
            if (!GetExitCodeProcess(pi.hProcess, out exitCode))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot read the sandboxed exit code");
            return unchecked((int)exitCode);
        }

        private static string BuildCommandLine(string[] argv)
        {
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < argv.Length; i++)
            {
                if (i > 0) builder.Append(' ');
                string argument = argv[i];
                if (argument.Length > 0 && argument.IndexOfAny(SpacesAndQuotes) < 0)
                {
                    builder.Append(argument);
                    continue;
                }
                builder.Append('"');
                int backslashes = 0;
                for (int c = 0; c < argument.Length; c++)
                {
                    char current = argument[c];
                    if (current == '\\')
                    {
                        backslashes++;
                        continue;
                    }
                    if (current == '"')
                    {
                        builder.Append('\\', backslashes * 2 + 1);
                        builder.Append('"');
                    }
                    else
                    {
                        builder.Append('\\', backslashes);
                        builder.Append(current);
                    }
                    backslashes = 0;
                }
                builder.Append('\\', backslashes * 2);
                builder.Append('"');
            }
            return builder.ToString();
        }

        private static readonly char[] SpacesAndQuotes = new char[] { ' ', '\t', '\n', '\r', '"' };

        [StructLayout(LayoutKind.Sequential)]
        private struct SID_AND_ATTRIBUTES
        {
            public IntPtr Sid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TOKEN_DEFAULT_DACL
        {
            public IntPtr DefaultDacl;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessAsUserW(
            IntPtr token,
            string applicationName,
            string commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, uint infoLength, out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CreateRestrictedToken(
            IntPtr existingToken,
            uint flags,
            uint disableSidCount,
            IntPtr sidsToDisable,
            uint deletePrivilegeCount,
            IntPtr privilegesToDelete,
            uint restrictSidCount,
            IntPtr sidsToRestrict,
            out IntPtr newToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool SetTokenInformation(IntPtr token, int infoClass, IntPtr info, uint infoLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint GetLengthSid(IntPtr sid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CopySid(uint destinationLength, IntPtr destination, IntPtr source);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint infoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr process, IntPtr job);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(uint standardHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        private const int STARTF_USESTDHANDLES = 0x00000100;
    }
}
`;
