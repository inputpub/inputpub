// TypeScript's bundled DOM lib already has FileSystemDirectoryHandle/
// FileSystemFileHandle (getDirectoryHandle, getFileHandle, entries(), etc.)
// but is missing the permission-query methods and the global picker — add
// just those via declaration merging instead of pulling in a types package.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}
