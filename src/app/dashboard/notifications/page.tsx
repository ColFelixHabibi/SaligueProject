
'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Bell, Check, ShoppingCart, User, Package, MessageSquare } from 'lucide-react';
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useNotificationStore, Notification } from '@/hooks/use-notification-store';
import { useDashboardSearchStore } from '@/hooks/use-dashboard-search-store';


const getIconForType = (type: string) => {
    switch (type) {
        case 'sale':
            return <ShoppingCart className="h-6 w-6 text-green-500" />;
        case 'message':
             return <MessageSquare className="h-6 w-6 text-blue-500" />;
        case 'review':
             return <User className="h-6 w-6 text-yellow-500" />;
        case 'account':
             return <User className="h-6 w-6 text-purple-500" />;
        case 'product':
             return <Package className="h-6 w-6 text-orange-500" />;
        default:
            return <Bell className="h-6 w-6 text-muted-foreground" />;
    }
}


export default function NotificationsPage() {
    const { notifications, markAsRead, markAllAsRead } = useNotificationStore();
    const router = useRouter();
    const { searchQuery } = useDashboardSearchStore();

    const filteredNotifications = useMemo(() => {
        if (!searchQuery) {
            return notifications;
        }
        return notifications.filter(notification =>
            notification.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            notification.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery, notifications]);


    const handleNotificationClick = (notification: Notification) => {
        markAsRead(notification.id);
        if (notification.link) {
            router.push(notification.link);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
                    <p className="text-muted-foreground">Manage your account and sales notifications.</p>
                </div>
                <Button onClick={markAllAsRead}>
                    <Check className="mr-2 h-4 w-4" />
                    Mark all as read
                </Button>
            </div>
            <Card>
                <CardContent className="p-0">
                    <div className="divide-y divide-border">
                        {filteredNotifications.length > 0 ? (
                            filteredNotifications.map((notification) => (
                                <div 
                                    key={notification.id} 
                                    className={cn(
                                        "flex items-start gap-4 p-4 transition-colors cursor-pointer hover:bg-muted/50",
                                        !notification.read && "bg-primary/5"
                                    )}
                                    onClick={() => handleNotificationClick(notification)}
                                >
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted flex-shrink-0">
                                        {getIconForType(notification.type)}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center">
                                            <p className="font-semibold">{notification.title}</p>
                                            <p className="text-xs text-muted-foreground">{notification.time}</p>
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                                            {notification.description}
                                        </p>
                                    </div>
                                    {!notification.read && (
                                        <div className="h-2.5 w-2.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-10">
                                <p className="text-muted-foreground">No notifications match your search.</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
