// Finder 入口只定位 Resources 内的 Neutralino，不创建第二个常驻进程。
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char executable[PATH_MAX], resolved[PATH_MAX], runtime[PATH_MAX];
    uint32_t length = sizeof(executable);
    if (_NSGetExecutablePath(executable, &length) || !realpath(executable, resolved)) return 1;
    char *separator = strrchr(resolved, '/');
    if (!separator) return 1;
    *separator = '\0';
    int written = snprintf(runtime, sizeof(runtime), "%s/../Resources/qudai", resolved);
    if (written < 0 || (size_t)written >= sizeof(runtime)) return 1;
    char **arguments = calloc((size_t)argc + 1, sizeof(char *));
    if (!arguments) return 1;
    arguments[0] = runtime;
    for (int i = 1; i < argc; ++i) arguments[i] = argv[i];
    execv(runtime, arguments);
    perror("Unable to start Qudai");
    free(arguments);
    return 1;
}
